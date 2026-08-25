import { Injectable, Logger } from '@nestjs/common'
import { v7 as uuidv7 } from 'uuid'
import { getDbPool } from '@barghsa/db'
import { SessionService } from '../session/session.service.js'
import type { UpdateProfileDto, VerifyProfileDto } from './crm-v2.controller.js'

/** Simple email regex for server-side validation */
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

/** Iranian mobile regex: starts with 09 followed by 9 digits */
const MOBILE_RE = /^09\d{9}$/

/** Allowed verification actions */
const VERIFY_ACTIONS = ['verify', 'unverify', 'reverify'] as const
type VerifyAction = (typeof VERIFY_ACTIONS)[number]

/**
 * Maps a verification action to the resulting profile status,
 * and returns the set of source states that permit the transition.
 */
const VERIFY_TRANSITIONS: Record<
  VerifyAction,
  { targetStatus: string; allowedFrom: string[] }
> = {
  verify: { targetStatus: 'VERIFIED', allowedFrom: ['DRAFT', 'ACTIVE'] },
  unverify: { targetStatus: 'ACTIVE', allowedFrom: ['VERIFIED'] },
  reverify: { targetStatus: 'DRAFT', allowedFrom: ['VERIFIED'] },
}

/**
 * Result type for profile update in CrmV2Service.
 */
export type CrmUpdateProfileResult =
  | { updated: true; profile: { id: string; title: string | null; updatedAt: string }; user: { username: string; email: string | null; mobile: string | null } }
  | { error: string }
  | null

/**
 * Result type for profile verification in CrmV2Service.
 */
export type CrmVerifyProfileResult =
  | { success: true; profileId: string; previousStatus: string; newStatus: string; reason: string | null }
  | { error: string }
  | null

export type CrmForcePasswordChangeResult =
  | { success: true; userId: string; reason: string }
  | { error: string }
  | null

export type CrmExpireSessionsResult =
  | { success: true; userId: string; reason: string }
  | { error: string }
  | null

/**
 * A single address record on a CRM profile.
 */
export interface CrmProfileAddress {
  id: string
  provinceId: string
  cityId: string
  fullAddress: string
  postalCode: string
  mainAddress: boolean
  createdAt: string
}

/**
 * A single session record on a CRM profile.
 */
export interface CrmProfileSession {
  sessionId: string
  createdAt: string
  lastActive: string
  deviceInfo: Record<string, unknown> | null
  expiresAt: string
  isRevoked: boolean
}

/**
 * Legal entity data attached to a LEGAL-type profile.
 */
export interface CrmLegalInfo {
  legalName: string
  nationalIdentifier: string
  registrationNumber: string
  companyTypeId: string | null
  economicCode: string | null
  officialPhone: string | null
  officialEmail: string | null
  officialProvinceId: string | null
  officialCityId: string | null
  officialFullAddress: string | null
  officialPostalCode: string | null
  representativeTitle: string
  representativeRelationship: string
}

/**
 * A single profile on the same user (profile switcher context).
 */
export interface CrmSiblingProfile {
  id: string
  profileType: 'INDIVIDUAL' | 'LEGAL'
  isDefault: boolean
  status: string
  title: string | null
}

/**
 * Complete CRM profile detail DTO returned by the endpoint.
 */
export interface CrmProfileDetail {
  profile: {
    id: string
    profileType: 'INDIVIDUAL' | 'LEGAL'
    status: string
    title: string | null
    firstName: string | null
    lastName: string | null
    nationalId: string | null
    createdAt: string
    updatedAt: string
  }
  user: {
    userId: string
    username: string
    email: string | null
    mobile: string | null
    lastLogin: string | null
    isAdmin: boolean
    createdAt: string
  }
  legalInfo: CrmLegalInfo | null
  addresses: CrmProfileAddress[]
  sessions: {
    count: number
    lastActive: string | null
    entries: CrmProfileSession[]
  }
  siblingProfiles: CrmSiblingProfile[]
}

@Injectable()
export class CrmV2Service {
  private readonly logger = new Logger(CrmV2Service.name)

  constructor(private readonly sessionService: SessionService) {}

  /**
   * GET /api/crm/profiles/:profileId
   *
   * Returns a comprehensive profile detail view for CRM staff, including
   * profile data, user info, verification state, session metadata,
   * addresses, and sibling profiles.
   */
  async getProfileDetail(profileId: string): Promise<CrmProfileDetail | null> {
    const pool = getDbPool()

    // 1. Fetch the profile
    const profileResult = await pool.query(
      `SELECT id, user_id, profile_type, is_default, status, title,
              first_name, last_name, national_id,
              created_at AT TIME ZONE 'UTC' AS created_at,
              updated_at AT TIME ZONE 'UTC' AS updated_at
       FROM profiles
       WHERE id = $1`,
      [profileId],
    )

    if (profileResult.rows.length === 0) {
      return null
    }

    const profileRow = profileResult.rows[0] as Record<string, unknown>

    // 2. Fetch the user associated with this profile
    const userResult = await pool.query(
      `SELECT user_id, username, email, mobile,
              last_login_at AT TIME ZONE 'UTC' AS last_login_at,
              is_admin, created_at AT TIME ZONE 'UTC' AS created_at
       FROM users
       WHERE user_id = $1`,
      [profileRow.user_id],
    )

    const userRow = userResult.rows[0] as Record<string, unknown> | undefined
    if (!userRow) {
      this.logger.warn(`Profile ${profileId} has orphaned user_id ${String(profileRow.user_id)}`)
      return null
    }

    // 3. Fetch addresses for this profile
    const addressResult = await pool.query(
      `SELECT id, profile_id, province_id, city_id, full_address, postal_code, main_address,
              created_at AT TIME ZONE 'UTC' AS created_at
       FROM addresses
       WHERE profile_id = $1
       ORDER BY main_address DESC, created_at ASC`,
      [profileId],
    )

    const addresses: CrmProfileAddress[] = addressResult.rows.map(
      (row: Record<string, unknown>) => ({
        id: row.id as string,
        provinceId: row.province_id as string,
        cityId: row.city_id as string,
        fullAddress: row.full_address as string,
        postalCode: row.postal_code as string,
        mainAddress: row.main_address as boolean,
        createdAt: (row.created_at as string) ?? '',
      }),
    )

    // 4. Fetch session metadata for the user
    const sessionResult = await pool.query(
      `SELECT session_id, created_at AT TIME ZONE 'UTC' AS created_at,
              updated_at AT TIME ZONE 'UTC' AS updated_at,
              device_info, expires_at AT TIME ZONE 'UTC' AS expires_at,
              revoked_at IS NOT NULL AS is_revoked
       FROM sessions
       WHERE user_id = $1
       ORDER BY updated_at DESC
       LIMIT 20`,
      [userRow.user_id],
    )

    const sessionsList: CrmProfileSession[] = sessionResult.rows.map(
      (row: Record<string, unknown>) => ({
        sessionId: row.session_id as string,
        createdAt: (row.created_at as string) ?? '',
        lastActive: (row.updated_at as string) ?? '',
        deviceInfo: (row.device_info as Record<string, unknown>) ?? null,
        expiresAt: (row.expires_at as string) ?? '',
        isRevoked: (row.is_revoked as boolean) ?? false,
      }),
    )

    const sessionCountResult = await pool.query(
      `SELECT COUNT(*)::int AS cnt FROM sessions WHERE user_id = $1 AND revoked_at IS NULL`,
      [userRow.user_id],
    )

    const activeSessionCount = (sessionCountResult.rows[0] as Record<string, unknown>).cnt as number

    // 5. Fetch sibling profiles (other profiles for the same user)
    const siblingResult = await pool.query(
      `SELECT id, profile_type, is_default, status, title
       FROM profiles
       WHERE user_id = $1 AND id != $2
       ORDER BY is_default DESC, created_at ASC`,
      [userRow.user_id, profileId],
    )

    const siblingProfiles: CrmSiblingProfile[] = siblingResult.rows.map(
      (row: Record<string, unknown>) => ({
        id: row.id as string,
        profileType: row.profile_type as 'INDIVIDUAL' | 'LEGAL',
        isDefault: row.is_default as boolean,
        status: row.status as string,
        title: (row.title as string) ?? null,
      }),
    )

    // 6. Fetch legal info if this is a LEGAL profile
    let legalInfo: CrmLegalInfo | null = null
    if (profileRow.profile_type === 'LEGAL') {
      const legalResult = await pool.query(
        `SELECT legal_name, national_identifier, registration_number, company_type_id,
                economic_code, official_phone, official_email,
                official_province_id, official_city_id,
                official_full_address, official_postal_code,
                representative_title, representative_relationship
         FROM legal_profiles
         WHERE id = $1`,
        [profileId],
      )

      if (legalResult.rows.length > 0) {
        const lr = legalResult.rows[0] as Record<string, unknown>
        legalInfo = {
          legalName: lr.legal_name as string,
          nationalIdentifier: lr.national_identifier as string,
          registrationNumber: lr.registration_number as string,
          companyTypeId: (lr.company_type_id as string) ?? null,
          economicCode: (lr.economic_code as string) ?? null,
          officialPhone: (lr.official_phone as string) ?? null,
          officialEmail: (lr.official_email as string) ?? null,
          officialProvinceId: (lr.official_province_id as string) ?? null,
          officialCityId: (lr.official_city_id as string) ?? null,
          officialFullAddress: (lr.official_full_address as string) ?? null,
          officialPostalCode: (lr.official_postal_code as string) ?? null,
          representativeTitle: lr.representative_title as string,
          representativeRelationship: lr.representative_relationship as string,
        }
      }
    }

    // Determine last active session
    const lastActive = sessionsList.length > 0 ? sessionsList[0]!.lastActive : null

    return {
      profile: {
        id: profileRow.id as string,
        profileType: profileRow.profile_type as 'INDIVIDUAL' | 'LEGAL',
        status: profileRow.status as string,
        title: (profileRow.title as string) ?? null,
        firstName: (profileRow.first_name as string) ?? null,
        lastName: (profileRow.last_name as string) ?? null,
        nationalId: (profileRow.national_id as string) ?? null,
        createdAt: (profileRow.created_at as string) ?? '',
        updatedAt: (profileRow.updated_at as string) ?? '',
      },
      user: {
        userId: userRow.user_id as string,
        username: userRow.username as string,
        email: (userRow.email as string) ?? null,
        mobile: (userRow.mobile as string) ?? null,
        lastLogin: (userRow.last_login_at as string) ?? null,
        isAdmin: (userRow.is_admin as boolean) ?? false,
        createdAt: (userRow.created_at as string) ?? '',
      },
      legalInfo,
      addresses,
      sessions: {
        count: activeSessionCount,
        lastActive,
        entries: sessionsList,
      },
      siblingProfiles,
    }
  }

  /**
   * PUT /api/crm/profiles/:profileId
   *
   * Updates editable fields on a CRM profile. Identity fields are blocked
   * for direct editing. Changes to email/mobile update the users table;
   * title updates the profiles table. Records a profile_updated audit event.
   */
  async updateProfile(
    profileId: string,
    dto: UpdateProfileDto,
    actorUserId: string,
    ip: string,
  ): Promise<CrmUpdateProfileResult> {
    const pool = getDbPool()

    // 1. Fetch the profile to verify it exists and get current values
    const profileResult = await pool.query(
      `SELECT id, user_id, title, status, profile_type
       FROM profiles
       WHERE id = $1`,
      [profileId],
    )

    if (profileResult.rows.length === 0) return null

    const profileRow = profileResult.rows[0] as Record<string, unknown>

    // 2. Field-level validation
    if (dto.email !== undefined && dto.email !== null && dto.email !== '') {
      if (!EMAIL_RE.test(dto.email)) {
        return { error: 'Invalid email format' }
      }
    }
    if (dto.mobile !== undefined && dto.mobile !== null && dto.mobile !== '') {
      if (!MOBILE_RE.test(dto.mobile)) {
        return { error: 'Invalid Iranian mobile number format (must be 09xxxxxxxxx)' }
      }
    }

    // 3. Build the changeset — only allowed fields
    const profileChanges: Record<string, unknown> = {}
    const userChanges: Record<string, unknown> = {}
    const beforeDiff: Record<string, unknown> = {}
    const afterDiff: Record<string, unknown> = {}

    if (dto.title !== undefined) {
      const oldVal = profileRow.title as string | null
      if (oldVal !== dto.title) {
        profileChanges.title = dto.title
        beforeDiff.title = oldVal
        afterDiff.title = dto.title
      }
    }

    // Always fetch the current user row (needed for username in response)
    const userResult = await pool.query(
      `SELECT username, email, mobile FROM users WHERE user_id = $1`,
      [profileRow.user_id],
    )
    if (userResult.rows.length === 0) return null
    const userRow = userResult.rows[0] as Record<string, unknown>

    // Track before values for user fields
    if (dto.email !== undefined) {
      const oldVal = userRow.email as string | null
      if (oldVal !== dto.email) {
        userChanges.email = dto.email
        beforeDiff.email = oldVal
        afterDiff.email = dto.email
      }
    }

    if (dto.mobile !== undefined) {
      const oldVal = userRow.mobile as string | null
      if (oldVal !== dto.mobile) {
        userChanges.mobile = dto.mobile
        beforeDiff.mobile = oldVal
        afterDiff.mobile = dto.mobile
      }
    }

    // 3. If nothing changed, return early (no-op with current data)
    if (Object.keys(profileChanges).length === 0 && Object.keys(userChanges).length === 0) {
      return {
        updated: true,
        profile: {
          id: profileId,
          title: (profileRow.title as string) ?? null,
          updatedAt: (profileRow.updated_at as string) ?? '',
        },
        user: {
          username: (userRow.username as string) ?? '',
          email: (userRow.email as string | null) ?? null,
          mobile: (userRow.mobile as string | null) ?? null,
        },
      }
    }

    // 4. Apply changes in a transaction
    const client = await pool.connect()
    try {
      await client.query('BEGIN')

      const now = new Date().toISOString()

      if (Object.keys(profileChanges).length > 0) {
        const setClauses = Object.entries(profileChanges)
          .map(([key], i) => `${key} = $${i + 1}`)
        const values = Object.values(profileChanges)
        setClauses.push(`updated_at = $${values.length + 1}::timestamptz`)
        values.push(now)

        await client.query(
          `UPDATE profiles SET ${setClauses.join(', ')} WHERE id = $${values.length + 1}`,
          [...values, profileId],
        )
      }

      if (Object.keys(userChanges).length > 0) {
        const setClauses = Object.entries(userChanges)
          .map(([key], i) => `${key} = $${i + 1}`)
        const values = Object.values(userChanges)
        setClauses.push(`updated_at = NOW()`)

        await client.query(
          `UPDATE users SET ${setClauses.join(', ')} WHERE user_id = $${values.length + 1}`,
          [...values, profileRow.user_id as string],
        )
      }

      // 5. Record audit event
      const auditId = uuidv7()
      const correlationId = uuidv7()
      await client.query(
        `INSERT INTO audit_log (id, user_id, event, metadata, correlation_id, ip, created_at)
         VALUES ($1, $2, $3, $4::jsonb, $5, $6, $7)`,
        [auditId, actorUserId, 'profile_updated', JSON.stringify({ profileId, before: beforeDiff, after: afterDiff }), correlationId, ip, now],
      )

      await client.query('COMMIT')

      this.logger.debug(
        `Profile ${profileId} updated by ${actorUserId}: ${JSON.stringify(beforeDiff)} → ${JSON.stringify(afterDiff)}`,
      )

      return {
        updated: true,
        profile: {
          id: profileId,
          title: (dto.title !== undefined ? dto.title : profileRow.title) as string | null,
          updatedAt: now,
        },
        user: {
          username: (userRow.username as string) ?? '',
          email: (dto.email !== undefined ? dto.email : userRow.email) as string | null,
          mobile: (dto.mobile !== undefined ? dto.mobile : userRow.mobile) as string | null,
        },
      }
    } catch (err) {
      await client.query('ROLLBACK')
      this.logger.error(`Failed to update profile ${profileId}: ${String(err)}`)
      throw err
    } finally {
      client.release()
    }
  }

  /**
   * POST /api/crm/profiles/:profileId/verify
   *
   * Changes the verification state of a profile. Actions:
   * - `verify` — marks profile as VERIFIED (from DRAFT or ACTIVE)
   * - `unverify` — reverts to ACTIVE (from VERIFIED)
   * - `reverify` — resets to DRAFT (from VERIFIED), flags for re-verification
   *
   * Permission: admin or staff with crm:verify role required.
   * Audit: verification_change with before/after state, actor, reason.
   * Notification context is included in audit metadata for downstream
   * delivery to the profile owner.
   */
  async verifyProfile(
    profileId: string,
    dto: VerifyProfileDto,
    actorUserId: string,
    ip: string,
  ): Promise<CrmVerifyProfileResult> {
    if (!VERIFY_ACTIONS.includes(dto.action as VerifyAction)) {
      return { error: `Invalid verification action. Must be one of: ${VERIFY_ACTIONS.join(', ')}` }
    }

    const action = dto.action as VerifyAction
    const transition = VERIFY_TRANSITIONS[action]

    const pool = getDbPool()

    // 1. Fetch the profile to verify existence and current status
    const profileResult = await pool.query(
      `SELECT id, user_id, status FROM profiles WHERE id = $1`,
      [profileId],
    )

    if (profileResult.rows.length === 0) return null

    const profileRow = profileResult.rows[0] as Record<string, unknown>
    const currentStatus = profileRow.status as string
    const targetStatus = transition.targetStatus

    // 2. If the profile is already in the target state, return no-op success
    if (currentStatus === targetStatus) {
      return {
        success: true,
        profileId,
        previousStatus: currentStatus,
        newStatus: targetStatus,
        reason: dto.reason ?? null,
      }
    }

    // 3. Validate state transition
    if (!transition.allowedFrom.includes(currentStatus)) {
      return {
        error: `Cannot ${action} a profile with status '${currentStatus}'. ` +
          `Allowed source statuses: ${transition.allowedFrom.join(', ')}`,
      }
    }

    // 4. Reason is required for unverify and reverify
    if ((action === 'unverify' || action === 'reverify') && (!dto.reason || dto.reason.trim() === '')) {
      return { error: `Reason is required for '${action}' action` }
    }

    const now = new Date().toISOString()
    const correlationId = uuidv7()
    const client = await pool.connect()

    try {
      await client.query('BEGIN')

      // Update profile status
      await client.query(
        `UPDATE profiles SET status = $1, updated_at = $2::timestamptz WHERE id = $3`,
        [targetStatus, now, profileId],
      )

      // Record audit event
      const auditId = uuidv7()
      await client.query(
        `INSERT INTO audit_log (id, user_id, event, metadata, correlation_id, ip, created_at)
         VALUES ($1, $2, $3, $4::jsonb, $5, $6, $7)`,
        [
          auditId,
          actorUserId,
          'verification_change',
          JSON.stringify({
            profileId,
            previousStatus: currentStatus,
            newStatus: targetStatus,
            action,
            reason: dto.reason ?? null,
            profileOwnerUserId: profileRow.user_id as string,
          }),
          correlationId,
          ip,
          now,
        ],
      )

      await client.query('COMMIT')

      this.logger.debug(
        `Profile ${profileId} verification changed: ${currentStatus} → ${targetStatus} ` +
        `(action: ${action}, actor: ${actorUserId})`,
      )

      return {
        success: true,
        profileId,
        previousStatus: currentStatus,
        newStatus: targetStatus,
        reason: dto.reason ?? null,
      }
    } catch (err) {
      await client.query('ROLLBACK')
      this.logger.error(`Failed to verify profile ${profileId}: ${String(err)}`)
      throw err
    } finally {
      client.release()
    }
  }

  /**
   * Forces a password change for a user by setting must_change_password = true
   * and revoking all their active sessions.
   *
   * Returns null if the user is not found.
   */
  async forcePasswordChange(
    userId: string,
    reason: string,
    actorUserId: string,
    ip: string,
  ): Promise<CrmForcePasswordChangeResult> {
    if (!reason || reason.trim() === '') {
      return { error: 'Reason is required for force password change' }
    }

    const pool = getDbPool()

    // Verify user exists
    const userResult = await pool.query(
      `SELECT user_id FROM users WHERE user_id = $1`,
      [userId],
    )
    if (userResult.rows.length === 0) return null

    const client = await pool.connect()
    try {
      await client.query('BEGIN')

      await client.query(
        `UPDATE users SET must_change_password = true, updated_at = NOW() WHERE user_id = $1`,
        [userId],
      )

      await this.sessionService.revokeAllUserSessions(userId)

      const auditId = uuidv7()
      const correlationId = uuidv7()
      await client.query(
        `INSERT INTO audit_log (id, user_id, event, metadata, correlation_id, ip, created_at)
         VALUES ($1, $2, $3, $4::jsonb, $5, $6, NOW())`,
        [
          auditId,
          actorUserId,
          'force_password_change',
          JSON.stringify({ targetUserId: userId, reason }),
          correlationId,
          ip,
        ],
      )

      await client.query('COMMIT')

      this.logger.debug(
        `Password change forced for user ${userId} by ${actorUserId}: ${reason}`,
      )

      return { success: true, userId, reason }
    } catch (err) {
      await client.query('ROLLBACK')
      this.logger.error(`Failed to force password change for user ${userId}: ${String(err)}`)
      throw err
    } finally {
      client.release()
    }
  }

  /**
   * Expires (revokes) all active sessions for a user without forcing a
   * password change. Use for session invalidation scenarios (e.g. security
   * incidents, device loss) where the password is still trusted.
   *
   * Returns null if the user is not found.
   */
  async expireSessions(
    userId: string,
    reason: string,
    actorUserId: string,
    ip: string,
  ): Promise<CrmExpireSessionsResult> {
    if (!reason || reason.trim() === '') {
      return { error: 'Reason is required for expire sessions' }
    }

    const pool = getDbPool()

    // Verify user exists
    const userResult = await pool.query(
      `SELECT user_id FROM users WHERE user_id = $1`,
      [userId],
    )
    if (userResult.rows.length === 0) return null

    const client = await pool.connect()
    try {
      await client.query('BEGIN')

      await this.sessionService.revokeAllUserSessions(userId)

      const auditId = uuidv7()
      const correlationId = uuidv7()
      await client.query(
        `INSERT INTO audit_log (id, user_id, event, metadata, correlation_id, ip, created_at)
         VALUES ($1, $2, $3, $4::jsonb, $5, $6, NOW())`,
        [
          auditId,
          actorUserId,
          'expire_sessions',
          JSON.stringify({ targetUserId: userId, reason }),
          correlationId,
          ip,
        ],
      )

      await client.query('COMMIT')

      this.logger.debug(
        `Sessions expired for user ${userId} by ${actorUserId}: ${reason}`,
      )

      return { success: true, userId, reason }
    } catch (err) {
      await client.query('ROLLBACK')
      this.logger.error(`Failed to expire sessions for user ${userId}: ${String(err)}`)
      throw err
    } finally {
      client.release()
    }
  }
}