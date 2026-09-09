import { editCrmLegalInfo, readCrmLegalInfo } from './crm-profile-legal.js';
import { editCrmAddress } from './crm-profile-address.js';
import { ErrorCodes } from '@barghsa/shared/errors';
import { createHash } from 'node:crypto';
import { HttpException, Injectable, Logger } from '@nestjs/common';
import { v7 as uuidv7 } from 'uuid';
import { getDbPool } from '@barghsa/db';
import { NotificationsService } from '../notifications/notifications.service.js';
import { SessionService } from '../session/session.service.js';
import { requireStaffMutationPermission } from '../admin/staff-mutation-permission.js';
import type { PoolClient } from 'pg';
import type { UpdateProfileDto, VerifyProfileDto } from './crm-v2.controller.js';
import {
  readAgentRecords,
  readVerificationRecords,
  type CrmRecordPage,
  type CrmAgentRecord,
  type CrmVerificationRecord,
} from './crm-profile-records.js';

/** Simple email regex for server-side validation */
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Iranian mobile regex: starts with 09 followed by 9 digits */
const MOBILE_RE = /^09\d{9}$/;

/** Allowed verification actions */
const VERIFY_ACTIONS = ['verify', 'unverify', 'reverify'] as const;
type VerifyAction = (typeof VERIFY_ACTIONS)[number];

/**
 * Maps a verification action to the resulting profile status,
 * and returns the set of source states that permit the transition.
 */
const VERIFY_TRANSITIONS: Record<VerifyAction, { targetStatus: string; allowedFrom: string[] }> = {
  verify: { targetStatus: 'VERIFIED', allowedFrom: ['DRAFT', 'ACTIVE', 'PENDING_VERIFICATION'] },
  unverify: { targetStatus: 'ACTIVE', allowedFrom: ['VERIFIED'] },
  reverify: { targetStatus: 'PENDING_VERIFICATION', allowedFrom: ['VERIFIED'] },
};

/**
 * Result type for profile update in CrmV2Service.
 */
export type CrmUpdateProfileResult =
  | {
      updated: true;
      profile: {
        id: string;
        title: string | null;
        contactEmail: string | null;
        contactMobile: string | null;
        updatedAt: string;
      };
      user: { username: string; email: string | null; mobile: string | null };
      address?: CrmProfileAddress;
      legalInfo?: CrmLegalInfo;
    }
  | { error: string }
  | null;

/**
 * Result type for profile verification in CrmV2Service.
 */
export type CrmVerifyProfileResult =
  | {
      success: true;
      profileId: string;
      previousStatus: string;
      newStatus: string;
      reason: string | null;
    }
  | { error: string }
  | null;

export type CrmForcePasswordChangeResult =
  { success: true; userId: string; reason: string } | { error: string } | null;

export type CrmExpireSessionsResult =
  { success: true; userId: string; reason: string } | { error: string } | null;

/**
 * A single profile entry in the pending verification dashboard widget.
 */
export interface PendingVerificationProfile {
  id: string;
  profileType: 'INDIVIDUAL' | 'LEGAL';
  firstName: string | null;
  lastName: string | null;
  legalName: string | null;
  createdAt: string;
}

export interface CrmLocalizedName {
  nameFa: string;
  nameEn: string;
}

/** A single address record on a CRM profile. */
export interface CrmProfileAddress {
  id: string;
  provinceId: string;
  cityId: string;
  provinceName: CrmLocalizedName | null;
  cityName: CrmLocalizedName | null;
  fullAddress: string;
  postalCode: string;
  mainAddress: boolean;
  createdAt: string;
  updatedAt: string;
}

/**
 * A single session record on a CRM profile.
 */
export interface CrmProfileSession {
  sessionId: string;
  createdAt: string;
  lastActive: string;
  deviceInfo: Record<string, unknown> | null;
  expiresAt: string;
  isRevoked: boolean;
  isActive: boolean;
}

/**
 * Legal entity data attached to a LEGAL-type profile.
 */
export interface CrmLegalInfo {
  legalName: string;
  nationalIdentifier: string;
  registrationNumber: string;
  companyTypeId: string | null;
  companyTypeName: CrmLocalizedName | null;
  registrationDate: string | null;
  economicCode: string | null;
  officialPhone: string | null;
  officialEmail: string | null;
  officialProvinceId: string | null;
  officialCityId: string | null;
  officialFullAddress: string | null;
  officialPostalCode: string | null;
  officialProvinceName: CrmLocalizedName | null;
  officialCityName: CrmLocalizedName | null;
  representativeHonorific: string | null;
  representativeFirstName: string | null;
  representativeLastName: string | null;
  representativeNationalId: string | null;
  representativeProvinceId: string | null;
  representativeCityId: string | null;
  representativeProvinceName: CrmLocalizedName | null;
  representativeCityName: CrmLocalizedName | null;
  representativeFullAddress: string | null;
  representativePostalCode: string | null;
  createdAt: string;
  updatedAt: string;
  representativeTitle: string;
  representativeRelationship: string;
}

/**
 * A single profile on the same user (profile switcher context).
 */
export interface CrmSiblingProfile {
  id: string;
  profileType: 'INDIVIDUAL' | 'LEGAL';
  isDefault: boolean;
  status: string;
  title: string | null;
}

/**
 * Complete CRM profile detail DTO returned by the endpoint.
 */
export interface CrmProfileDetail {
  profile: {
    id: string;
    isDefault: boolean;
    archived: boolean;
    archivedAt: string | null;
    archivedReason: string | null;
    profileType: 'INDIVIDUAL' | 'LEGAL';
    status: string;
    title: string | null;
    contactEmail: string | null;
    contactMobile: string | null;
    firstName: string | null;
    lastName: string | null;
    nationalId: string | null;
    createdAt: string;
    updatedAt: string;
  };
  user: {
    userId: string;
    username: string;
    email: string | null;
    mobile: string | null;
    lastLogin: string | null;
    lastPasswordChange: string | null;
    isAdmin: boolean;
    createdAt: string;
  };
  legalInfo: CrmLegalInfo | null;
  addresses: CrmProfileAddress[];
  sessions: {
    count: number;
    lastActive: string | null;
    entries: CrmProfileSession[];
  };
  siblingProfiles: CrmSiblingProfile[];
  agentRelationships: CrmRecordPage<CrmAgentRecord>;
  verificationHistory: CrmRecordPage<CrmVerificationRecord>;
}

function localizedName(value: unknown): CrmLocalizedName | null {
  if (!value || typeof value !== 'object') return null;
  const name = value as Partial<CrmLocalizedName>;
  return typeof name.nameFa === 'string' && typeof name.nameEn === 'string'
    ? { nameFa: name.nameFa, nameEn: name.nameEn }
    : null;
}

@Injectable()
export class CrmV2Service {
  private readonly logger = new Logger(CrmV2Service.name);

  constructor(
    private readonly sessionService: SessionService,
    private readonly notificationsService: NotificationsService
  ) {}

  /**
   * GET /api/crm/profiles/:profileId
   *
   * Returns a comprehensive profile detail view for CRM staff, including
   * profile data, user info, verification state, session metadata,
   * addresses, and sibling profiles.
   */
  async getProfileDetail(
    profileId: string,
    includeCorrections = false
  ): Promise<CrmProfileDetail | null> {
    const pool = getDbPool();

    // 1. Fetch the profile
    const profileResult = await pool.query(
      `SELECT id, user_id, profile_type, is_default, status, title, contact_email, contact_mobile,
              first_name, last_name, national_id, archived, archived_at, archived_reason,
              created_at AT TIME ZONE 'UTC' AS created_at,
              updated_at AT TIME ZONE 'UTC' AS updated_at
       FROM profiles
       WHERE id = $1`,
      [profileId]
    );

    if (profileResult.rows.length === 0) {
      return null;
    }

    const profileRow = profileResult.rows[0] as Record<string, unknown>;

    // 2. Fetch the user associated with this profile
    const userResult = await pool.query(
      `SELECT user_id, username, email, mobile,
              last_login_at AT TIME ZONE 'UTC' AS last_login_at,
              (SELECT MAX(h.created_at) FROM password_history h
               WHERE h.user_id = users.user_id) AS last_password_change,
              is_admin, created_at AT TIME ZONE 'UTC' AS created_at
       FROM users
       WHERE user_id = $1`,
      [profileRow.user_id]
    );

    const userRow = userResult.rows[0] as Record<string, unknown> | undefined;
    if (!userRow) {
      this.logger.warn(`Profile ${profileId} has orphaned user_id ${String(profileRow.user_id)}`);
      return null;
    }

    // 3. Fetch addresses for this profile
    const addressResult = await pool.query(
      `SELECT a.id, a.province_id, a.city_id, a.full_address, a.postal_code, a.main_address,
              a.created_at,
              to_char(a.updated_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS updated_at,
              json_build_object('nameFa', p.name_fa, 'nameEn', p.name_en) AS province_name,
              json_build_object('nameFa', c.name_fa, 'nameEn', c.name_en) AS city_name
       FROM addresses a
       LEFT JOIN provinces p ON p.id=a.province_id
       LEFT JOIN cities c ON c.id=a.city_id AND c.province_id=p.id
       WHERE a.profile_id = $1 AND a.deleted_at IS NULL
       ORDER BY a.main_address DESC, a.created_at ASC`,
      [profileId]
    );

    const addresses: CrmProfileAddress[] = addressResult.rows.map(
      (row: Record<string, unknown>) => ({
        id: row.id as string,
        provinceId: row.province_id as string,
        cityId: row.city_id as string,
        provinceName: localizedName(row.province_name),
        cityName: localizedName(row.city_name),
        fullAddress: row.full_address as string,
        postalCode: row.postal_code as string,
        mainAddress: row.main_address as boolean,
        createdAt: (row.created_at as string) ?? '',
        updatedAt: (row.updated_at as string) ?? '',
      })
    );

    // 4. Fetch session metadata for the user
    const sessionResult = await pool.query(
      `SELECT session_id, created_at AT TIME ZONE 'UTC' AS created_at,
              updated_at AT TIME ZONE 'UTC' AS updated_at,
              CASE WHEN device_info IS NULL THEN NULL
                   ELSE jsonb_strip_nulls(jsonb_build_object(
                     'ip',device_info->>'ip','userAgent',device_info->>'userAgent',
                     'browser',device_info->>'browser','os',device_info->>'os'))
              END AS device_info, expires_at AT TIME ZONE 'UTC' AS expires_at,
              revoked_at IS NOT NULL AS is_revoked,
              (revoked_at IS NULL AND expires_at > NOW() AND idle_deadline > NOW()) AS is_active
       FROM sessions
       WHERE user_id = $1
       ORDER BY updated_at DESC
       LIMIT 20`,
      [userRow.user_id]
    );

    const sessionsList: CrmProfileSession[] = sessionResult.rows.map(
      (row: Record<string, unknown>) => ({
        // Never expose the bearer cookie used to authenticate this session.
        sessionId: `session-ref:${createHash('sha256').update(String(row.session_id)).digest('hex')}`,
        createdAt: (row.created_at as string) ?? '',
        lastActive: (row.updated_at as string) ?? '',
        deviceInfo: (row.device_info as Record<string, unknown>) ?? null,
        expiresAt: (row.expires_at as string) ?? '',
        isRevoked: (row.is_revoked as boolean) ?? false,
        isActive: row.is_active === true,
      })
    );

    const sessionCountResult = await pool.query(
      `SELECT COUNT(*)::int AS cnt FROM sessions WHERE user_id = $1 AND revoked_at IS NULL AND expires_at > NOW() AND idle_deadline > NOW()`,
      [userRow.user_id]
    );

    const activeSessionCount = (sessionCountResult.rows[0] as Record<string, unknown>)
      .cnt as number;

    // 5. Fetch sibling profiles (other profiles for the same user)
    const siblingResult = await pool.query(
      `SELECT id, profile_type, is_default, status, title
       FROM profiles
       WHERE user_id = $1 AND id != $2
       ORDER BY is_default DESC, created_at ASC`,
      [userRow.user_id, profileId]
    );

    const siblingProfiles: CrmSiblingProfile[] = siblingResult.rows.map(
      (row: Record<string, unknown>) => ({
        id: row.id as string,
        profileType: row.profile_type as 'INDIVIDUAL' | 'LEGAL',
        isDefault: row.is_default as boolean,
        status: row.status as string,
        title: (row.title as string) ?? null,
      })
    );

    // 6. Fetch legal info if this is a LEGAL profile
    const legalInfo =
      profileRow.profile_type === 'LEGAL' ? await readCrmLegalInfo(pool, profileId) : null;

    // Determine last active session
    const lastActive = sessionsList.length > 0 ? sessionsList[0]!.lastActive : null;
    const agentRelationships = await readAgentRecords(pool, {
      id: String(profileRow.id),
      userId: String(userRow.user_id),
      profileType: String(profileRow.profile_type),
      username: String(userRow.username),
    });
    const verificationHistory = await readVerificationRecords(
      pool,
      String(profileRow.id),
      undefined,
      includeCorrections
    );

    return {
      profile: {
        id: profileRow.id as string,
        isDefault: profileRow.is_default === true,
        archived: profileRow.archived === true,
        archivedAt: (profileRow.archived_at as string) ?? null,
        archivedReason: (profileRow.archived_reason as string) ?? null,
        profileType: profileRow.profile_type as 'INDIVIDUAL' | 'LEGAL',
        status: profileRow.status as string,
        title: (profileRow.title as string) ?? null,
        contactEmail: (profileRow.contact_email as string) ?? null,
        contactMobile: (profileRow.contact_mobile as string) ?? null,
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
        lastPasswordChange: (userRow.last_password_change as string) ?? null,
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
      agentRelationships,
      verificationHistory,
    };
  }

  async getProfileRecords(
    profileId: string,
    kind: 'agents' | 'verification',
    cursor?: string,
    includeCorrections = false
  ) {
    const pool = getDbPool();
    const scope = (
      await pool.query<{ id: string; userId: string; profileType: string; username: string }>(
        `SELECT p.id,p.user_id AS "userId",p.profile_type AS "profileType",u.username
       FROM profiles p JOIN users u ON u.user_id=p.user_id WHERE p.id=$1`,
        [profileId]
      )
    ).rows[0];
    if (!scope) return null;
    return kind === 'agents'
      ? readAgentRecords(pool, scope, cursor)
      : readVerificationRecords(pool, scope.id, cursor, includeCorrections);
  }

  /**
   * PUT /api/crm/profiles/:profileId
   *
   * Updates editable fields on a CRM profile. Identity fields are blocked
   * for direct editing. Email/mobile are profile contacts, never account credentials;
   * title updates the profiles table. Records a profile_updated audit event.
   */
  async updateProfile(
    profileId: string,
    dto: UpdateProfileDto,
    actorUserId: string,
    ip: string
  ): Promise<CrmUpdateProfileResult> {
    const email = dto.email?.trim().toLowerCase() || null;
    const mobileInput = dto.mobile?.trim() || null;
    const mobile =
      mobileInput && MOBILE_RE.test(mobileInput) ? `+98${mobileInput.slice(1)}` : mobileInput;
    if (dto.title !== undefined && dto.title !== null && dto.title.length > 256)
      return { error: 'Title is too long' };
    if (email && (email.length > 254 || !EMAIL_RE.test(email)))
      return { error: 'Invalid email format' };
    if (mobile && !/^\+989\d{9}$/.test(mobile))
      return { error: 'Invalid Iranian mobile number format' };
    const client = await getDbPool().connect();
    try {
      await client.query('BEGIN');
      const found = await client.query(
        `SELECT id,user_id,profile_type,title,contact_email,contact_mobile,archived,updated_at
        FROM profiles WHERE id=$1 FOR UPDATE`,
        [profileId]
      );
      const profile = found.rows[0];
      if (!profile) {
        await client.query('ROLLBACK');
        return null;
      }
      await requireStaffMutationPermission(client, actorUserId, 'crm:edit');
      if (profile.archived)
        throw new HttpException(
          {
            statusCode: 409,
            error: ErrorCodes.CONFLICT_STATE.code,
            message: 'Archived profiles cannot be edited',
          },
          409
        );
      const account = (
        await client.query('SELECT username,email,mobile FROM users WHERE user_id=$1', [
          profile.user_id,
        ])
      ).rows[0];
      if (!account) {
        await client.query('ROLLBACK');
        return null;
      }
      const changes: Record<string, unknown> = {};
      const before: Record<string, unknown> = {},
        after: Record<string, unknown> = {};
      for (const [field, column, value] of [
        ['title', 'title', dto.title],
        ['email', 'contact_email', dto.email === undefined ? undefined : email],
        ['mobile', 'contact_mobile', dto.mobile === undefined ? undefined : mobile],
      ] as const) {
        if (value !== undefined && (profile[column] ?? null) !== value) {
          changes[column] = value;
          before[field] = profile[column] ?? null;
          after[field] = value;
        }
      }
      if (dto.legal && profile.profile_type !== 'LEGAL')
        throw new HttpException({ error: ErrorCodes.VALIDATION_INPUT_INVALID.code }, 400);
      const legalChange = dto.legal ? await editCrmLegalInfo(client, profileId, dto.legal) : null;
      if (legalChange?.changed) {
        before.legal = legalChange.before;
        after.legal = legalChange.after;
      }
      const addressChange = dto.address
        ? await editCrmAddress(client, profileId, dto.address)
        : null;
      if (addressChange?.changed) {
        before.address = addressChange.before;
        after.address = addressChange.after;
      }
      if (Object.keys(changes).length || addressChange?.changed || legalChange?.changed) {
        const entries = Object.entries(changes);
        const updated = await client.query(
          `UPDATE profiles SET ${[...entries.map(([key], index) => `${key}=$${index + 1}`), 'updated_at=NOW()'].join(',')}
          WHERE id=$${entries.length + 1} RETURNING updated_at`,
          [...entries.map(([, value]) => value), profileId]
        );
        await client.query(
          `INSERT INTO audit_log(id,user_id,event,metadata,correlation_id,ip)
          VALUES ($1,$2,'profile_updated',$3::jsonb,$4,$5)`,
          [
            uuidv7(),
            actorUserId,
            JSON.stringify({
              profileId,
              scope: dto.address || dto.legal ? 'profile_details' : 'profile_contact',
              before,
              after,
            }),
            uuidv7(),
            ip,
          ]
        );
        Object.assign(profile, changes, { updated_at: updated.rows[0].updated_at });
      }
      await client.query('COMMIT');
      return {
        updated: true,
        ...(addressChange ? { address: addressChange.address } : {}),
        ...(legalChange ? { legalInfo: legalChange.legalInfo } : {}),
        profile: {
          id: profileId,
          title: profile.title ?? null,
          contactEmail: profile.contact_email ?? null,
          contactMobile: profile.contact_mobile ?? null,
          updatedAt: new Date(profile.updated_at).toISOString(),
        },
        user: {
          username: account.username,
          email: account.email ?? null,
          mobile: account.mobile ?? null,
        },
      };
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      throw error;
    } finally {
      client.release();
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
    ip: string
  ): Promise<CrmVerifyProfileResult> {
    if (!VERIFY_ACTIONS.includes(dto.action as VerifyAction))
      return { error: `Invalid verification action. Must be one of: ${VERIFY_ACTIONS.join(', ')}` };
    const action = dto.action as VerifyAction,
      transition = VERIFY_TRANSITIONS[action];
    const reason = dto.reason?.trim() || null;
    if ((action === 'unverify' || action === 'reverify') && !reason)
      return { error: `Reason is required for '${action}' action` };
    const client = await getDbPool().connect();
    try {
      await client.query('BEGIN');
      const profile = (
        await client.query(
          'SELECT id,user_id,status FROM profiles WHERE id=$1 AND archived=false FOR UPDATE',
          [profileId]
        )
      ).rows[0];
      if (!profile) {
        await client.query('COMMIT');
        return null;
      }
      await requireStaffMutationPermission(client, actorUserId, 'crm:verify');
      const currentStatus = profile.status as string,
        targetStatus = transition.targetStatus;
      const result = {
        success: true as const,
        profileId,
        previousStatus: currentStatus,
        newStatus: targetStatus,
        reason,
      };
      if (currentStatus === targetStatus) {
        await client.query('COMMIT');
        return result;
      }
      if (!transition.allowedFrom.includes(currentStatus)) {
        await client.query('COMMIT');
        return {
          error: `Cannot ${action} a profile with status '${currentStatus}'. Allowed source statuses: ${transition.allowedFrom.join(', ')}`,
        };
      }
      const now = new Date(),
        correlationId = uuidv7();
      await client.query('UPDATE profiles SET status=$1,updated_at=$2 WHERE id=$3', [
        targetStatus,
        now,
        profileId,
      ]);
      await client.query(
        `INSERT INTO audit_log(id,user_id,event,metadata,correlation_id,ip,created_at)
        VALUES ($1,$2,'verification_change',$3::jsonb,$4,$5,$6)`,
        [
          uuidv7(),
          actorUserId,
          JSON.stringify({
            profileId,
            previousStatus: currentStatus,
            newStatus: targetStatus,
            action,
            reason,
            profileOwnerUserId: profile.user_id,
          }),
          correlationId,
          ip || null,
          now,
        ]
      );
      const content =
        action === 'verify'
          ? {
              fa: { title: 'پروفایل شما تأیید شد', body: 'پروفایل شما توسط کارشناس تأیید شد.' },
              en: {
                title: 'Your profile was verified',
                body: 'A staff reviewer verified your profile.',
              },
            }
          : action === 'unverify'
            ? {
                fa: {
                  title: 'تأیید پروفایل لغو شد',
                  body: `تأیید پروفایل شما لغو شد. دلیل: ${reason}`,
                },
                en: {
                  title: 'Profile verification revoked',
                  body: `Your profile verification was revoked. Reason: ${reason}`,
                },
              }
            : {
                fa: {
                  title: 'پروفایل نیاز به تأیید مجدد دارد',
                  body: `پروفایل شما در انتظار تأیید مجدد است. دلیل: ${reason}`,
                },
                en: {
                  title: 'Profile verification requested again',
                  body: `Your profile is awaiting verification again. Reason: ${reason}`,
                },
              };
      await this.notificationsService.create(
        {
          userId: profile.user_id,
          profileId,
          type:
            action === 'verify'
              ? 'profile_verified'
              : action === 'unverify'
                ? 'profile_unverified'
                : 'profile_pending',
          title: content.fa.title,
          body: content.fa.body,
          localizedContent: content,
          link: '/settings/profile',
        },
        client
      );
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  private async notifyAccountAction(
    userId: string,
    action: 'password' | 'sessions',
    client: PoolClient
  ): Promise<void> {
    const content =
      action === 'password'
        ? {
            fa: {
              title: 'تغییر رمز عبور لازم است',
              body: 'کارشناس تغییر رمز عبور حساب شما را درخواست کرده است. هنگام ورود بعدی، رمز عبور جدید انتخاب کنید.',
            },
            en: {
              title: 'Password change required',
              body: 'A staff member required a password change for your account. Choose a new password the next time you sign in.',
            },
          }
        : {
            fa: {
              title: 'نشست‌های شما بسته شد',
              body: 'کارشناس نشست‌های فعال حساب شما را بسته است. برای ادامه دوباره وارد شوید.',
            },
            en: {
              title: 'Your sessions were signed out',
              body: 'A staff member signed out your active sessions. Sign in again to continue.',
            },
          };
    await this.notificationsService.create(
      {
        userId,
        type: 'general',
        title: content.fa.title,
        body: content.fa.body,
        localizedContent: content,
        link: '/settings/security',
      },
      client
    );
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
    ip: string
  ): Promise<CrmForcePasswordChangeResult> {
    if (!reason || reason.trim() === '') {
      return { error: 'Reason is required for force password change' };
    }

    const pool = getDbPool();

    // Verify user exists
    const userResult = await pool.query(`SELECT user_id FROM users WHERE user_id = $1`, [userId]);
    if (userResult.rows.length === 0) return null;

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      await requireStaffMutationPermission(client, actorUserId, 'admin:users:edit', userId);
      const target = await client.query('SELECT user_id FROM users WHERE user_id=$1', [userId]);
      if (!target.rows.length) {
        await client.query('ROLLBACK');
        return null;
      }

      await client.query(
        `UPDATE users SET must_change_password = true, updated_at = NOW() WHERE user_id = $1`,
        [userId]
      );

      await this.sessionService.revokeAllUserSessions(userId, undefined, client);

      const auditId = uuidv7();
      const correlationId = uuidv7();
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
        ]
      );

      await this.notifyAccountAction(userId, 'password', client);
      await client.query('COMMIT');

      this.logger.debug(`Password change forced for user ${userId} by ${actorUserId}: ${reason}`);

      return { success: true, userId, reason };
    } catch (err) {
      await client.query('ROLLBACK');
      this.logger.error(`Failed to force password change for user ${userId}: ${String(err)}`);
      throw err;
    } finally {
      client.release();
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
    ip: string
  ): Promise<CrmExpireSessionsResult> {
    if (!reason || reason.trim() === '') {
      return { error: 'Reason is required for expire sessions' };
    }

    const pool = getDbPool();

    // Verify user exists
    const userResult = await pool.query(`SELECT user_id FROM users WHERE user_id = $1`, [userId]);
    if (userResult.rows.length === 0) return null;

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      await requireStaffMutationPermission(client, actorUserId, 'admin:users:edit', userId);
      const target = await client.query('SELECT user_id FROM users WHERE user_id=$1', [userId]);
      if (!target.rows.length) {
        await client.query('ROLLBACK');
        return null;
      }

      await this.sessionService.revokeAllUserSessions(userId, undefined, client);

      const auditId = uuidv7();
      const correlationId = uuidv7();
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
        ]
      );

      await this.notifyAccountAction(userId, 'sessions', client);
      await client.query('COMMIT');

      this.logger.debug(`Sessions expired for user ${userId} by ${actorUserId}: ${reason}`);

      return { success: true, userId, reason };
    } catch (err) {
      await client.query('ROLLBACK');
      this.logger.error(`Failed to expire sessions for user ${userId}: ${String(err)}`);
      throw err;
    } finally {
      client.release();
    }
  }

  /**
   * DELETE /api/crm/profiles/:profileId
   *
   * Soft-deletes (archives) a customer profile. Staff must have admin
   * permission. Profiles with active orders, contracts, unpaid invoices,
   * or non-zero wallet balance cannot be deleted. Legal profiles cannot
   * be deleted if they would leave the legal entity with no owner.
   *
   * This is a soft delete: the row remains in the database with the
   * `archived` flag set to true. GDPR retention rules apply to the
   * archived data.
   */
  async deleteProfile(
    profileId: string,
    reason: string,
    actorUserId: string,
    ip: string
  ): Promise<CrmDeleteProfileResult> {
    if (!reason || reason.trim() === '') {
      return {
        errorCode: 'CRM:PROFILE:DELETION_BLOCKED',
        error: 'Reason is required for profile deletion',
      };
    }

    const pool = getDbPool();

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const profileResult = await client.query(
        `SELECT id,user_id,profile_type,status,archived FROM profiles WHERE id=$1 FOR UPDATE`,
        [profileId]
      );
      if (!profileResult.rows.length) {
        await client.query('ROLLBACK');
        return null;
      }
      const profileRow = profileResult.rows[0] as Record<string, unknown>;
      await requireStaffMutationPermission(client, actorUserId, 'admin:users:edit');
      if (profileRow.archived === true) {
        await client.query('ROLLBACK');
        return {
          errorCode: 'CRM:PROFILE:ALREADY_ARCHIVED',
          error: 'Profile is already archived',
          blocker: 'alreadyArchived',
        };
      }
      const profileType = profileRow.profile_type as string;

      // Correction creation/review uses the same profile lock, so this cannot
      // miss a case that commits concurrently with archival.
      const openCorrections = await client.query(
        `SELECT EXISTS(SELECT 1 FROM verification_cases WHERE profile_id=$1
          AND status IN ('Open','Under Review')) AS pending`,
        [profileId]
      );
      if (openCorrections.rows[0].pending) {
        await client.query('ROLLBACK');
        return {
          errorCode: 'CRM:PROFILE:DELETION_BLOCKED',
          blocker: 'corrections',
          error: 'Resolve open identity corrections before archiving this profile.',
        };
      }

      // 3. Check business constraints
      // Check for active orders (status != 'CANCELLED')
      const activeOrders = await client.query(
        `SELECT COUNT(*)::int AS cnt FROM orders
         WHERE profile_id = $1 AND status != 'CANCELLED'`,
        [profileId]
      );
      const activeOrderCount = (activeOrders.rows[0] as Record<string, unknown>).cnt as number;
      if (activeOrderCount > 0) {
        await client.query('ROLLBACK');
        return {
          errorCode: 'CRM:PROFILE:DELETION_BLOCKED',
          blocker: 'orders',
          count: activeOrderCount,
          error: `Profile has ${activeOrderCount} active order(s). Cancel orders before deletion.`,
        };
      }

      // Check for contracts (if table exists)
      const contractsTableExists = await client.query(
        `SELECT EXISTS (
          SELECT FROM information_schema.tables
          WHERE table_schema = 'public' AND table_name = 'contracts'
        ) AS exists`
      );
      if ((contractsTableExists.rows[0] as Record<string, unknown>).exists) {
        const activeContracts = await client.query(
          `SELECT COUNT(*)::int AS cnt FROM contracts WHERE profile_id = $1`,
          [profileId]
        );
        const activeContractCount = (activeContracts.rows[0] as Record<string, unknown>)
          .cnt as number;
        if (activeContractCount > 0) {
          await client.query('ROLLBACK');
          return {
            errorCode: 'CRM:PROFILE:DELETION_BLOCKED',
            blocker: 'contracts',
            count: activeContractCount,
            error: `Profile has ${activeContractCount} contract(s). Resolve contracts before deletion.`,
          };
        }
      }

      // Check for unpaid invoices (if table exists)
      const invoicesTableExists = await client.query(
        `SELECT EXISTS (
          SELECT FROM information_schema.tables
          WHERE table_schema = 'public' AND table_name = 'invoices'
        ) AS exists`
      );
      if ((invoicesTableExists.rows[0] as Record<string, unknown>).exists) {
        const unpaidInvoices = await client.query(
          `SELECT COUNT(*)::int AS cnt FROM invoices WHERE profile_id = $1
           AND adjustment_kind IS DISTINCT FROM 'credit'
           AND state NOT IN ('Paid','Cancelled','Refunded','PartiallyRefunded')`,
          [profileId]
        );
        const unpaidInvoiceCount = (unpaidInvoices.rows[0] as Record<string, unknown>)
          .cnt as number;
        if (unpaidInvoiceCount > 0) {
          await client.query('ROLLBACK');
          return {
            errorCode: 'CRM:PROFILE:DELETION_BLOCKED',
            blocker: 'invoices',
            count: unpaidInvoiceCount,
            error: `Profile has ${unpaidInvoiceCount} unpaid invoice(s). Resolve invoices before deletion.`,
          };
        }
      }

      // Check for wallet balance (if table exists)
      const walletsTableExists = await client.query(
        `SELECT EXISTS (
          SELECT FROM information_schema.tables
          WHERE table_schema = 'public' AND table_name = 'wallets'
        ) AS exists`
      );
      if ((walletsTableExists.rows[0] as Record<string, unknown>).exists) {
        const walletResult = await client.query(
          `SELECT posted_balance, reserved_balance FROM wallets WHERE profile_id = $1 FOR UPDATE`,
          [profileId]
        );
        if (walletResult.rows.length > 0) {
          const wallet = walletResult.rows[0] as {
            posted_balance: string;
            reserved_balance: string;
          };
          if (BigInt(wallet.posted_balance) !== 0n || BigInt(wallet.reserved_balance) !== 0n) {
            await client.query('ROLLBACK');
            return {
              errorCode: 'CRM:PROFILE:DELETION_BLOCKED',
              blocker: 'wallet',
              error: 'Profile has a non-zero wallet balance. Zero the balance before deletion.',
            };
          }
        }
      }

      // Top-up initiation holds the profile before the wallet lock. Pending
      // credits must settle or fail before a zero-balance wallet can archive.
      const pendingWallet = await client.query(
        `SELECT EXISTS(SELECT 1 FROM wallet_transactions WHERE wallet_id=$1 AND state='Pending') AS pending`,
        [profileId]
      );
      if (pendingWallet.rows[0].pending) {
        await client.query('ROLLBACK');
        return {
          errorCode: 'CRM:PROFILE:DELETION_BLOCKED',
          blocker: 'pendingPayments',
          error: 'Resolve pending wallet transactions before archiving this profile.',
        };
      }

      // A legal profile has one canonical owner in profiles.user_id. Agents
      // cannot substitute for that owner or authorize deleting the legal entity.
      if (profileType === 'LEGAL') {
        await client.query('ROLLBACK');
        return {
          errorCode: 'CRM:PROFILE:LAST_OWNER',
          blocker: 'lastOwner',
          error: 'Cannot archive a legal profile while its canonical ownership remains active.',
        };
      }

      const now = new Date().toISOString();
      const correlationId = uuidv7();

      // 5. Soft-delete the profile — set archived flag
      await client.query(
        `UPDATE profiles
         SET archived = true, archived_at = $1::timestamptz, archived_reason = $2, updated_at = $1::timestamptz
         WHERE id = $3`,
        [now, reason, profileId]
      );

      // 6. Record audit event
      const auditId = uuidv7();
      await client.query(
        `INSERT INTO audit_log (id, user_id, event, metadata, correlation_id, ip, created_at)
         VALUES ($1, $2, $3, $4::jsonb, $5, $6, $7)`,
        [
          auditId,
          actorUserId,
          'profile_deleted',
          JSON.stringify({
            profileId,
            profileType,
            reason,
            profileOwnerUserId: profileRow.user_id as string,
            gdprRetentionNote:
              'GDPR retention period applies. Do not permanently delete before retention expiry.',
          }),
          correlationId,
          ip,
          now,
        ]
      );

      await client.query('COMMIT');

      this.logger.debug(`Profile ${profileId} archived by ${actorUserId}: ${reason}`);

      return {
        success: true,
        profileId,
        reason,
        archivedAt: now,
      };
    } catch (err) {
      await client.query('ROLLBACK');
      this.logger.error(`Failed to delete profile ${profileId}: ${String(err)}`);
      throw err;
    } finally {
      client.release();
    }
  }

  /**
   * GET /api/crm/dashboard/pending-verification
   *
   * Returns the count and last 5 profiles whose status is PENDING_VERIFICATION
   * (i.e. onboarding completed but awaiting staff verification).
   * Used by the staff dashboard widget.
   * Only returns non-archived profiles.
   */
  async getPendingVerification(): Promise<{
    enabled: boolean;
    count: number;
    profiles: PendingVerificationProfile[];
  }> {
    const pool = getDbPool();
    const settings = await pool.query<{ key: string; value: unknown }>(
      'SELECT key,value FROM app_config WHERE key=ANY($1::text[])',
      [['profile_verification_mode', 'verification.required']]
    );
    const config = new Map(settings.rows.map((row) => [row.key, row.value]));
    const mode = config.get('profile_verification_mode');
    // Match profile enforcement: an invalid explicit mode cannot disable verification.
    const enabled =
      mode != null ? mode !== 'DISABLED' : config.get('verification.required') === true;
    if (!enabled) return { enabled: false, count: 0, profiles: [] };

    const profileResult = await pool.query(
      `SELECT p.id, p.profile_type, p.first_name, p.last_name,
              lp.legal_name, COUNT(*) OVER()::int AS total_count,
              to_char(p.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS created_at
       FROM profiles p
       LEFT JOIN legal_profiles lp ON lp.id = p.id
       WHERE p.status = 'PENDING_VERIFICATION' AND p.archived = false
       ORDER BY p.created_at DESC, p.id DESC
       LIMIT 5`
    );

    const profiles: PendingVerificationProfile[] = profileResult.rows.map(
      (row: Record<string, unknown>) => ({
        id: row.id as string,
        profileType: row.profile_type as 'INDIVIDUAL' | 'LEGAL',
        firstName: (row.first_name as string) ?? null,
        lastName: (row.last_name as string) ?? null,
        legalName: (row.legal_name as string) ?? null,
        createdAt: (row.created_at as string) ?? '',
      })
    );

    return { enabled: true, count: (profileResult.rows[0]?.total_count as number) ?? 0, profiles };
  }
}

/**
 * Result type for profile deletion in CrmV2Service.
 */
export type CrmDeleteProfileResult =
  | { success: true; profileId: string; reason: string; archivedAt: string }
  | {
      errorCode: string;
      error: string;
      blocker?:
        | 'orders'
        | 'contracts'
        | 'invoices'
        | 'wallet'
        | 'corrections'
        | 'pendingPayments'
        | 'lastOwner'
        | 'alreadyArchived';
      count?: number;
    }
  | null;
