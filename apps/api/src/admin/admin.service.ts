import { Injectable, Logger, HttpException } from '@nestjs/common'
import { v7 as uuidv7 } from 'uuid'
import * as argon2 from 'argon2'
import { getDbPool, PREDEFINED_ROLES } from '@barghsa/db'
import {
  DELIVERY_WINDOW_CONFIG_KEY,
  DEFAULT_DELIVERY_WINDOW,
  toDeliveryWindowConfig,
  validateWindowConfig,
  type DeliveryWindowConfig,
} from '@barghsa/shared/notifications'
import {
  DUAL_APPROVAL_THRESHOLD_CONFIG_KEY,
  DEFAULT_DUAL_APPROVAL_CONFIG,
  toDualApprovalConfig,
  validateDualApprovalConfig,
  isValidDualApprovalThreshold,
  type DualApprovalConfig,
  WALLET_TOP_UP_LIMIT_CONFIG_KEY,
  DEFAULT_WALLET_TOP_UP_LIMIT_CONFIG,
  toWalletTopUpLimitConfig,
  validateWalletTopUpLimitConfig,
  isValidWalletTopUpLimit,
  type WalletTopUpLimitConfig,
  GREEN_ELECTRICITY_CONFIG_KEY,
  DEFAULT_GREEN_ELECTRICITY_CONFIG,
  toGreenElectricityConfig,
  validateGreenElectricityConfig,
  greenElectricityConfigToStored,
  type GreenElectricityConfig,
  GREEN_ELECTRICITY_ORDER_MODES,
  GREEN_ELECTRICITY_SYSTEM_KEY,
  evaluateGreenRuleEnforcement,
  type GreenElectricityProductState,
} from '@barghsa/shared/finance'
import {
  SERVICE_RESPONSE_TARGETS_CONFIG_KEY,
  SERVICE_RESPONSE_TARGET_TYPES,
  DEFAULT_SERVICE_RESPONSE_TARGETS,
  toServiceResponseTargets,
  validateServiceResponseTargets,
  type ServiceResponseTargets,
  STAFF_ASSIGNMENT_RULES_CONFIG_KEY,
  DEFAULT_STAFF_ASSIGNMENT_RULES,
  toStaffAssignmentRules,
  validateStaffAssignmentRules,
  validateStaffTeamInput,
  type StaffAssignmentRules,
  type StaffTeamRecord,
  type StaffTeamInput,
  ESCALATION_POLICY_CONFIG_KEY,
  DEFAULT_ESCALATION_POLICIES,
  toEscalationPolicies,
  validateEscalationPolicies,
  type EscalationPolicies,
} from '@barghsa/shared/admin'
import { ErrorCodes } from '@barghsa/shared/errors'

/**
 * Supported activation methods for new staff users.
 * - `tempPassword`: generate a temporary password, force change on first login.
 * - `link`: generate a time-limited activation link (24h).
 */
export type ActivationMethod = 'tempPassword' | 'link'

/**
 * Result of updating a staff user's roles.
 */
export interface UpdateStaffRolesResult {
  userId: string
  roleIds: string[]
  previousRoleIds: string[]
}

/**
 * A staff role with its permission set (T-09.05.01).
 */
export interface StaffRoleDto {
  roleId: string
  name: string
  description: string
  permissions: string[]
  predefined: boolean
  createdAt: string
  updatedAt: string
}

/**
 * A single permission with a human-readable, grouped representation.
 */
export interface PermissionDescriptor {
  /** Canonical permission string, e.g. `tickets:read`. */
  permission: string
  /** Group label derived from the permission prefix (e.g. `tickets`). */
  group: string
}

/**
 * Effective permission resolution for a staff user (T-09.05.01).
 *
 * The union of permissions across all roles held by the user, deny-by-default.
 * A platform admin (`is_admin`) resolves to the wildcard `*` set.
 */
export interface EffectivePermissionsResult {
  userId: string
  isAdmin: boolean
  roleIds: string[]
  roleNames: string[]
  permissions: PermissionDescriptor[]
  isWildcard: boolean
}

/**
 * Input for creating a staff user.
 */
export interface CreateStaffUserInput {
  username: string
  firstName: string
  lastName: string
  roleIds?: string[]
  activationMethod: ActivationMethod
}

/**
 * Result of creating a staff user.
 * Depending on activationMethod, either a temporary password or an activation token.
 */
export type CreateStaffUserResult = {
  userId: string
  username: string
  activationMethod: ActivationMethod
} & (
  | { temporaryPassword: string; activationToken?: never; message: string }
  | { activationToken: string; temporaryPassword?: never; message: string }
)

// ─── Staff user list & disable types (T-10.01.01) ────────────────────

/** Pagination for the staff list. */
export interface StaffListQuery {
  limit?: number
  offset?: number
}

/** One role held by a staff user (aggregated into the list row). */
export interface StaffUserRoleSummary {
  roleId: string
  name: string
}

/** One staff account in the admin staff list. */
export interface StaffUserSummary {
  userId: string
  username: string
  email: string | null
  mobile: string | null
  firstName: string | null
  lastName: string | null
  roles: StaffUserRoleSummary[]
  isAdmin: boolean
  lastLoginAt: string | null
  disabledAt: string | null
  status: 'active' | 'disabled'
  createdAt: string
}

/** Paginated staff list result. */
export interface StaffListResult {
  items: StaffUserSummary[]
  total: number
  limit: number
  offset: number
}

/** Input for disabling a staff account. */
export interface DisableStaffInput {
  userId: string
  actorUserId: string
  ip: string
}

/** Result of disabling a staff account. */
export interface DisableStaffResult {
  userId: string
  username: string
  status: 'disabled'
  disabledAt: string
  /** True when the account was already disabled (idempotent no-op). */
  alreadyDisabled: boolean
}

// ─── Staff permission audit types (T-10.01.02) ────────────────────────

/**
 * Filter for the staff permission audit timeline.
 *
 * The timeline is "per user": `userId` restricts to role changes of one
 * staff user (the `metadata.targetUserId` of `role_change` events), and
 * `from`/`to` bound the event time.
 */
export interface StaffAuditQuery {
  /** Restrict to role changes for a single staff user (UUID). */
  userId?: string
  /** Inclusive lower bound (ISO timestamp) on the event time. */
  from?: string
  /** Inclusive upper bound (ISO timestamp) on the event time. */
  to?: string
  limit?: number
  offset?: number
}

/** A role granted or revoked by a `role_change` audit event. */
export interface StaffAuditRoleChange {
  roleId: string
  roleName: string
}

/**
 * One `role_change` audit event rendered for the admin timeline.
 *
 * `addedRoles`/`removedRoles` are the computed diff between the previous
 * and the new role set — the UI renders them as "Assigned [role] by
 * [admin] on [date]" / "Removed [role] by [admin] on [date]".
 */
export interface StaffAuditEvent {
  id: string
  /** The staff user whose roles changed. */
  targetUserId: string
  targetUsername: string | null
  /** The admin who performed the change. */
  actorUserId: string
  actorUsername: string | null
  addedRoles: StaffAuditRoleChange[]
  removedRoles: StaffAuditRoleChange[]
  previousRoleIds: string[]
  newRoleIds: string[]
  reason: string | null
  correlationId: string | null
  ip: string | null
  createdAt: string
}

/** Paginated staff permission audit result. */
export interface StaffAuditResult {
  items: StaffAuditEvent[]
  total: number
  limit: number
  offset: number
}

/**
 * Character set for generating temporary passwords.
 * Ambiguous characters (0/O, 1/l/I) are excluded to avoid confusion.
 */
const PASSWORD_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789'

/**
 * Parse a stored permission set defensively. Handles both a JSON string
 * (TEXT column as written today) and an already-parsed JS array (if the
 * column is ever migrated to jsonb and node-postgres auto-parses it).
 * Invalid input degrades to an empty set.
 */
function parsePermissionsStored(raw: unknown): string[] {
  if (Array.isArray(raw)) {
    return raw.filter((p): p is string => typeof p === 'string')
  }
  if (typeof raw !== 'string') return []
  try {
    const parsed = JSON.parse(raw)
    if (Array.isArray(parsed)) return parsed.filter((p): p is string => typeof p === 'string')
    return []
  } catch {
    return []
  }
}

/**
 * Generates a cryptographically random password that satisfies the
 * project's password strength policy (min 8 chars, at least one
 * uppercase, one lowercase, one digit).
 *
 * Generates a full random string of 12 chars, then ensures character
 * class coverage by injecting random characters at random positions
 * rather than at fixed offsets.
 */
function generateTemporaryPassword(): string {
  const crypto = globalThis.crypto
  const length = 12
  const array = new Uint8Array(length)
  crypto.getRandomValues(array)

  // Build a random string from the character set
  let result = ''
  for (let i = 0; i < length; i++) {
    result += PASSWORD_CHARS[array[i]! % PASSWORD_CHARS.length]
  }

  // Ensure at least one uppercase, one lowercase, one digit by
  // replacing characters at random positions if the character class
  // is missing from the generated result.
  const upperRe = /[A-Z]/
  const lowerRe = /[a-z]/
  const digitRe = /[2-9]/

  const UPPER_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ'
  const LOWER_CHARS = 'abcdefghjkmnpqrstuvwxyz'
  const DIGITS = '23456789'

  const posBuf = new Uint8Array(1)
  const selBuf = new Uint8Array(1)

  if (!upperRe.test(result)) {
    crypto.getRandomValues(posBuf)
    const pos = posBuf[0]! % length
    crypto.getRandomValues(selBuf)
    const replacement = UPPER_CHARS[selBuf[0]! % UPPER_CHARS.length]
    result = result.slice(0, pos) + replacement + result.slice(pos + 1)
  }

  if (!lowerRe.test(result)) {
    crypto.getRandomValues(posBuf)
    const pos = posBuf[0]! % length
    crypto.getRandomValues(selBuf)
    const replacement = LOWER_CHARS[selBuf[0]! % LOWER_CHARS.length]
    result = result.slice(0, pos) + replacement + result.slice(pos + 1)
  }

  if (!digitRe.test(result)) {
    crypto.getRandomValues(posBuf)
    const pos = posBuf[0]! % length
    crypto.getRandomValues(selBuf)
    const replacement = DIGITS[selBuf[0]! % DIGITS.length]
    result = result.slice(0, pos) + replacement + result.slice(pos + 1)
  }

  return result
}

/**
 * PostgreSQL error code for unique constraint violation.
 */
const PG_UNIQUE_VIOLATION = '23505'

/**
 * UUID (versions 1–8) matcher for validating the audit `userId` filter.
 */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** Shape of the `role_change` metadata written by `updateStaffRoles`. */
interface RoleChangeMetadata {
  targetUserId: string
  previousRoleIds: string[]
  newRoleIds: string[]
  reason: string | null
}

/**
 * Parse the JSON `metadata` column of a `role_change` audit row
 * defensively. node-postgres may hand back a string (TEXT-like JSON) or an
 * already-parsed object; malformed rows degrade rather than crash the
 * timeline.
 */
function parseRoleChangeMetadata(raw: unknown): RoleChangeMetadata | null {
  let parsed: unknown = raw
  if (typeof raw === 'string') {
    try {
      parsed = JSON.parse(raw)
    } catch {
      return null
    }
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return null
  const meta = parsed as Record<string, unknown>
  if (typeof meta.targetUserId !== 'string') return null
  const previousRoleIds = Array.isArray(meta.previousRoleIds)
    ? meta.previousRoleIds.filter((id): id is string => typeof id === 'string')
    : []
  const newRoleIds = Array.isArray(meta.newRoleIds)
    ? meta.newRoleIds.filter((id): id is string => typeof id === 'string')
    : []
  const reason = typeof meta.reason === 'string' ? meta.reason : null
  return { targetUserId: meta.targetUserId, previousRoleIds, newRoleIds, reason }
}

/**
 * Admin service: staff user creation, role assignment, and user management.
 *
 * Dependencies: T-05.03.01 (this task), T-02.02.04 (step-up auth).
 * Permission: admin:users:create (currently backed by isAdmin session flag).
 */
@Injectable()
export class AdminService {
  private readonly logger = new Logger(AdminService.name)

  /**
   * Create a new staff user.
   *
   * Steps:
   * 1. Validate username uniqueness (optimistic pre-check + transaction guard)
   * 2. Generate password (tempPassword) or activation token (link)
   * 3. Hash password with Argon2id
   * 4. Create user record with is_admin = true (in transaction — catches
   *    unique violation as a TOCTOU safety net)
   * 5. Auto-create an individual, verified profile (no address needed)
   * 6. Record audit event
   *
   * @param input - Staff user creation input
   * @param actorUserId - The admin user performing the action
   * @param ip - Source IP for audit
   * @returns Staff user ID and activation details
   */
  async createStaffUser(
    input: CreateStaffUserInput,
    actorUserId: string,
    ip: string,
  ): Promise<CreateStaffUserResult> {
    const pool = getDbPool()

    // ── 1. Optimistic uniqueness pre-check (fast-fail) ────────────────
    const existing = await pool.query(
      `SELECT user_id FROM users WHERE username = $1`,
      [input.username],
    )

    if (existing.rows.length > 0) {
      throw new HttpException(
        {
          statusCode: 409,
          error: 'AUTH:REGISTER:USERNAME_TAKEN',
          message: 'Username is already taken',
        },
        409,
      )
    }

    // ── 1b. Validate role IDs against predefined roles ─────────────────
    const validRoleIds = new Set<string>(PREDEFINED_ROLES.map((r) => r.id))
    const assignedRoleIds = input.roleIds ?? []
    const invalidRoleIds = assignedRoleIds.filter((rid) => !validRoleIds.has(rid))

    if (invalidRoleIds.length > 0) {
      throw new HttpException(
        {
          statusCode: 400,
          error: 'VALIDATION_INVALID_ROLES',
          message: `Invalid role IDs: ${invalidRoleIds.join(', ')}`,
        },
        400,
      )
    }

    const userId = uuidv7()
    const now = new Date()

    // ── 2. Generate password or activation token ───────────────────────
    let passwordHash: string
    let mustChangePassword = false
    let activationToken: string | null = null
    let activationTokenExpiresAt: Date | null = null
    let temporaryPassword: string | null = null

    if (input.activationMethod === 'tempPassword') {
      temporaryPassword = generateTemporaryPassword()
      passwordHash = await argon2.hash(temporaryPassword)
      mustChangePassword = true
    } else {
      // Generate a strong random password for the user (they'll set their own via link)
      const strongPassword = generateTemporaryPassword()
      passwordHash = await argon2.hash(strongPassword)
      mustChangePassword = true
      activationToken = uuidv7()
      activationTokenExpiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000) // 24 hours
    }

    const client = await pool.connect()

    try {
      await client.query('BEGIN')

      // ── 3. Create user record ──────────────────────────────────────
      const userResult = await client.query(
        `INSERT INTO users (user_id, username, password_hash, is_admin, must_change_password,
                            activation_token, activation_token_expires_at, created_at, updated_at)
         VALUES ($1, $2, $3, true, $4, $5, $6, $7, $8)
         RETURNING user_id, username`,
        [
          userId,
          input.username,
          passwordHash,
          mustChangePassword,
          activationToken,
          activationTokenExpiresAt,
          now,
          now,
        ],
      )

      if (userResult.rows.length === 0) {
        await client.query('ROLLBACK')
        throw new HttpException(
          {
            statusCode: 500,
            error: 'INTERNAL_SERVER',
            message: 'Failed to create staff user',
          },
          500,
        )
      }

      // ── 4. Auto-create verified individual profile ──────────────────
      const profileId = uuidv7()
      await client.query(
        `INSERT INTO profiles (id, user_id, profile_type, is_default, status, first_name, last_name, created_at, updated_at)
         VALUES ($1, $2, 'INDIVIDUAL', true, 'VERIFIED', $3, $4, $5, $6)`,
        [profileId, userId, input.firstName, input.lastName, now, now],
      )

      // ── 4b. Assign initial roles ────────────────────────────────────
      if (assignedRoleIds.length > 0) {
        const insertRoleValues = assignedRoleIds.map((rid) => `($1, '${rid.replace(/'/g, "''")}', $2)`).join(', ')
        await client.query(
          `INSERT INTO user_roles (user_id, role_id, created_at) VALUES ${insertRoleValues}`,
          [userId, now],
        )
      }

      // ── 5. Record audit event ──────────────────────────────────────
      const auditId = uuidv7()
      const correlationId = uuidv7()
      await client.query(
        `INSERT INTO audit_log (id, user_id, event, metadata, correlation_id, ip, created_at)
         VALUES ($1, $2, $3, $4::jsonb, $5, $6, $7)`,
        [
          auditId,
          actorUserId,
          'staff_user_created',
          JSON.stringify({
            targetUserId: userId,
            username: input.username,
            activationMethod: input.activationMethod,
            roleIds: input.roleIds ?? [],
            profileId,
          }),
          correlationId,
          ip,
          now,
        ],
      )

      await client.query('COMMIT')

      this.logger.log(
        `Staff user created: userId=${userId}, username=${input.username}, ` +
        `method=${input.activationMethod}, actor=${actorUserId}`,
      )

      // ── 6. Return result ───────────────────────────────────────────
      if (input.activationMethod === 'tempPassword' && temporaryPassword) {
        return {
          userId,
          username: input.username,
          activationMethod: 'tempPassword',
          temporaryPassword,
          message: 'Staff user created. Save the temporary password — it will never be shown again.',
        }
      }

      return {
        userId,
        username: input.username,
        activationMethod: 'link',
        activationToken: activationToken!,
        message: 'Staff user created with activation token. Email delivery is not yet configured — use the activation token to construct the activation link.',
      }
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {
        // Non-critical
      })

      // Handle unique constraint violation as a TOCTOU safety net:
      // the pre-check raced with another concurrent creation.
      if (
        typeof error === 'object' &&
        error !== null &&
        'code' in error &&
        (error as { code: string }).code === PG_UNIQUE_VIOLATION
      ) {
        throw new HttpException(
          {
            statusCode: 409,
            error: 'AUTH:REGISTER:USERNAME_TAKEN',
            message: 'Username is already taken',
          },
          409,
        )
      }

      if (error instanceof HttpException) throw error

      this.logger.error(`Failed to create staff user: ${String(error)}`)
      throw new HttpException(
        {
          statusCode: 500,
          error: 'INTERNAL_SERVER',
          message: 'Failed to create staff user',
        },
        500,
      )
    } finally {
      client.release()
    }
  }

  /**
   * Update a staff user's role assignments.
   *
   * Replaces the current role set with the provided role IDs (idempotent).
   * Validates that all provided role IDs reference existing predefined roles.
   * Records an audit event with before/after role sets, actor, and reason.
   *
   * @param targetUserId - The staff user whose roles are being updated
   * @param roleIds - New role IDs to assign
   * @param actorUserId - The admin performing the action
   * @param ip - Source IP for audit
   * @param reason - Optional reason for the role change
   * @returns Previous and new role IDs
   */
  async updateStaffRoles(
    targetUserId: string,
    roleIds: string[],
    actorUserId: string,
    ip: string,
    reason?: string,
  ): Promise<{ userId: string; roleIds: string[]; previousRoleIds: string[] }> {
    const pool = getDbPool()

    // ── 1. Validate that the target user exists ──────────────────────────
    const userResult = await pool.query(
      `SELECT user_id, is_admin FROM users WHERE user_id = $1`,
      [targetUserId],
    )

    if (userResult.rows.length === 0) {
      throw new HttpException(
        { statusCode: 404, error: 'USER_NOT_FOUND', message: 'User not found' },
        404,
      )
    }

    // ── 2. Validate role IDs against predefined roles ────────────────────
    const validRoleIds = new Set<string>(PREDEFINED_ROLES.map((r) => r.id))
    const invalidRoleIds = roleIds.filter((rid) => !validRoleIds.has(rid))

    if (invalidRoleIds.length > 0) {
      throw new HttpException(
        {
          statusCode: 400,
          error: 'VALIDATION_INVALID_ROLES',
          message: `Invalid role IDs: ${invalidRoleIds.join(', ')}`,
        },
        400,
      )
    }

    const client = await pool.connect()
    const now = new Date()

    try {
      await client.query('BEGIN')

      // ── 3. Fetch current role set ─────────────────────────────────────
      const currentRolesResult = await client.query(
        `SELECT role_id FROM user_roles WHERE user_id = $1`,
        [targetUserId],
      )
      const previousRoleIds = currentRolesResult.rows.map((r: { role_id: string }) => r.role_id)

      // ── 4. Replace role set (delete all, insert new) ──────────────────
      await client.query(`DELETE FROM user_roles WHERE user_id = $1`, [targetUserId])

      if (roleIds.length > 0) {
        const insertValues = roleIds.map((rid) => `($1, '${rid.replace(/'/g, "''")}')`).join(', ')
        await client.query(
          `INSERT INTO user_roles (user_id, role_id, created_at) VALUES ${insertValues}`,
          [targetUserId],
        )
      }

      // ── 5. Record audit event ─────────────────────────────────────────
      const auditId = uuidv7()
      const correlationId = uuidv7()
      await client.query(
        `INSERT INTO audit_log (id, user_id, event, metadata, correlation_id, ip, created_at)
         VALUES ($1, $2, $3, $4::jsonb, $5, $6, $7)`,
        [
          auditId,
          actorUserId,
          'role_change',
          JSON.stringify({
            targetUserId,
            previousRoleIds,
            newRoleIds: roleIds,
            reason: reason ?? null,
          }),
          correlationId,
          ip,
          now,
        ],
      )

      await client.query('COMMIT')

      this.logger.log(
        `Roles updated for user ${targetUserId}: [${previousRoleIds.join(',')}] → [${roleIds.join(',')}], actor=${actorUserId}`,
      )

      return {
        userId: targetUserId,
        roleIds,
        previousRoleIds,
      }
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {
        // Non-critical
      })

      this.logger.error(`Failed to update roles for user ${targetUserId}: ${String(error)}`)
      throw new HttpException(
        { statusCode: 500, error: 'INTERNAL_SERVER', message: 'Failed to update staff roles' },
        500,
      )
    } finally {
      client.release()
    }
  }

  /**
   * List all staff roles with their permission sets (T-09.05.01).
   *
   * Reads the `staff_roles` table (seeded from PREDEFINED_ROLES) and marks each
   * role as predefined based on the canonical role IDs.
   */
  async listStaffRoles(): Promise<StaffRoleDto[]> {
    const pool = getDbPool()
    const result = await pool.query(
      `SELECT role_id, name, description, permissions, created_at, updated_at
       FROM staff_roles
       ORDER BY name ASC`,
    )

    const predefinedIds = new Set<string>(PREDEFINED_ROLES.map((r) => r.id))

    return result.rows.map((row) => {
      const permissions = parsePermissionsStored(row.permissions)

      return {
        roleId: row.role_id,
        name: row.name,
        description: row.description ?? '',
        permissions,
        predefined: predefinedIds.has(row.role_id),
        createdAt: row.created_at ? new Date(row.created_at).toISOString() : '',
        updatedAt: row.updated_at ? new Date(row.updated_at).toISOString() : '',
      }
    })
  }

  /**
   * Resolve the effective permission set for a staff user (T-09.05.01).
   *
   * The union of permissions across all roles held by the user (deny-by-default,
   * additive by role). A platform admin (`is_admin`) resolves to the wildcard
   * set (`isWildcard: true`) — an admin implicitly holds every permission.
   *
   * @param targetUserId - The staff user whose effective permissions to resolve
   * @throws 404 when the user does not exist
   */
  async getEffectivePermissions(targetUserId: string): Promise<EffectivePermissionsResult> {
    const pool = getDbPool()

    const userResult = await pool.query(
      `SELECT user_id, is_admin FROM users WHERE user_id = $1`,
      [targetUserId],
    )
    if (userResult.rows.length === 0) {
      throw new HttpException(
        { statusCode: 404, error: 'USER_NOT_FOUND', message: 'User not found' },
        404,
      )
    }
    const isAdmin = userResult.rows[0]!.is_admin === true

    const rolesResult = await pool.query(
      `SELECT r.role_id, r.name, r.permissions
       FROM user_roles ur
       JOIN staff_roles r ON r.role_id = ur.role_id
       WHERE ur.user_id = $1`,
      [targetUserId],
    )

    const roleIds: string[] = []
    const roleNames: string[] = []
    const permissionSet = new Set<string>()

    for (const row of rolesResult.rows) {
      roleIds.push(row.role_id)
      roleNames.push(row.name)
      for (const p of parsePermissionsStored(row.permissions)) permissionSet.add(p)
    }

    if (isAdmin) {
      return {
        userId: targetUserId,
        isAdmin: true,
        roleIds,
        roleNames,
        permissions: [{ permission: '*', group: 'admin' }],
        isWildcard: true,
      }
    }

    const permissions = [...permissionSet]
      .sort()
      .map((permission) => ({ permission, group: permission.split(':')[0] ?? 'other' }))

    return {
      userId: targetUserId,
      isAdmin,
      roleIds,
      roleNames,
      permissions,
      isWildcard: false,
    }
  }

  /**
   * Get the current profile verification mode from app_config.
   * Defaults to 'DISABLED' if the key is not set.
   */
  async getProfileVerificationMode(): Promise<{ mode: 'DISABLED' | 'MANUAL' | 'API' }> {
    const pool = getDbPool()
    const result = await pool.query(
      `SELECT value FROM app_config WHERE key = 'profile_verification_mode'`,
    )

    if (result.rows.length === 0) {
      return { mode: 'DISABLED' }
    }

    const mode = result.rows[0]!.value as 'DISABLED' | 'MANUAL' | 'API'
    return { mode }
  }

  /**
   * Set the profile verification mode.
   * Bumps the global config version for cache invalidation.
   */
  async setProfileVerificationMode(
    mode: 'DISABLED' | 'MANUAL' | 'API',
    actorUserId: string,
    ip: string,
  ): Promise<{ mode: 'DISABLED' | 'MANUAL' | 'API' }> {
    const pool = getDbPool()
    const now = new Date()

    const client = await pool.connect()
    try {
      await client.query('BEGIN')

      // Upsert the config value
      await client.query(
        `INSERT INTO app_config (key, value, version, updated_at)
         VALUES ('profile_verification_mode', $1::jsonb, 1, $2)
         ON CONFLICT (key) DO UPDATE SET value = $1::jsonb, version = app_config.version + 1, updated_at = $2`,
        [JSON.stringify(mode), now],
      )

      // Bump global config version for cache invalidation
      await client.query(
        `UPDATE config_version SET version = version + 1, updated_at = $1 WHERE id = 'global'`,
        [now],
      )

      // Record audit event
      const auditId = uuidv7()
      const correlationId = uuidv7()
      await client.query(
        `INSERT INTO audit_log (id, user_id, event, metadata, correlation_id, ip, created_at)
         VALUES ($1, $2, $3, $4::jsonb, $5, $6, $7)`,
        [
          auditId,
          actorUserId,
          'config_change',
          JSON.stringify({
            key: 'profile_verification_mode',
            newValue: mode,
          }),
          correlationId,
          ip,
          now,
        ],
      )

      await client.query('COMMIT')

      this.logger.log(`Profile verification mode set to ${mode} by ${actorUserId}`)
      return { mode }
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {})
      this.logger.error(`Failed to set profile verification mode: ${String(error)}`)
      throw new HttpException(
        { statusCode: 500, error: 'INTERNAL_SERVER', message: 'Failed to update config' },
        500,
      )
    } finally {
      client.release()
    }
  }

  // ───────────────────────────────────────────────────────────────────────
  // Delivery-window config (E-05, T-05.03.03)
  // ───────────────────────────────────────────────────────────────────────

  /**
   * Get the current admin-configurable delivery window from `app_config`.
   *
   * Returns the default 09:00–21:00 Asia/Tehran window when no admin value has
   * been persisted yet. Does **not** validate/normalize the stored value here —
   * the worker's `normalizeWindowConfig` applies a safe per-field fallback at
   * read time, so a corrupt value can never break delivery.
   *
   * The response uses the camelCase shape the UI form consumes
   * (`{ timezone, startHour, endHour }`).
   */
  async getDeliveryWindowConfig(): Promise<DeliveryWindowConfig> {
    const pool = getDbPool()
    const result = await pool.query(
      `SELECT value FROM app_config WHERE key = $1`,
      [DELIVERY_WINDOW_CONFIG_KEY],
    )
    if (result.rows.length === 0) return { ...DEFAULT_DELIVERY_WINDOW }
    // Persisted value is stored snake_case ({ timezone, start_hour, end_hour }).
    return toDeliveryWindowConfig(result.rows[0]!.value)
  }

  /**
   * Persist a new admin-configurable delivery window.
   *
   * Validates the proposal against the T-05.03.03 rules (start < end, length ≥
   * {@link MIN_WINDOW_HOURS}, valid IANA timezone) before writing. A failing
   * validation throws a 400 with the collected issue list so the client can
   * surface them. On success it upserts `app_config` and bumps the global
   * config version so the worker's config cache invalidates and picks up the
   * new window on its next wake-up.
   *
   * @param input - raw request body ({ timezone, start_hour, end_hour })
   * @param actorUserId - admin user performing the change (for audit)
   * @param ip - source IP (for audit)
   * @returns the persisted (camelCase) window config
   */
  async setDeliveryWindowConfig(
    input: unknown,
    actorUserId: string,
    ip: string,
  ): Promise<DeliveryWindowConfig> {
    const validation = validateWindowConfig(input)
    if (!validation.ok) {
      throw new HttpException(
        {
          statusCode: 400,
          error: ErrorCodes.VALIDATION_INPUT_INVALID.code,
          message: validation.issues.join('; '),
        },
        400,
      )
    }

    const config = toDeliveryWindowConfig(input)
    const pool = getDbPool()
    const now = new Date()

    // Persist in the snake_case shape `loadDeliveryWindowConfig` (worker) and
    // `normalizeWindowConfig` consume.
    const stored = {
      timezone: config.timezone,
      start_hour: config.startHour,
      end_hour: config.endHour,
    }

    const client = await pool.connect()
    try {
      await client.query('BEGIN')

      await client.query(
        `INSERT INTO app_config (key, value, version, updated_at)
         VALUES ($1, $2::jsonb, 1, $3)
         ON CONFLICT (key) DO UPDATE SET value = $2::jsonb, version = app_config.version + 1, updated_at = $3`,
        [DELIVERY_WINDOW_CONFIG_KEY, JSON.stringify(stored), now],
      )

      // Bump global config version for cache invalidation (worker wake-up).
      await client.query(
        `UPDATE config_version SET version = version + 1, updated_at = $1 WHERE id = 'global'`,
        [now],
      )

      // Record audit event (T-05.03.03: changes take effect for new schedules).
      const auditId = uuidv7()
      const correlationId = uuidv7()
      await client.query(
        `INSERT INTO audit_log (id, user_id, event, metadata, correlation_id, ip, created_at)
         VALUES ($1, $2, $3, $4::jsonb, $5, $6, $7)`,
        [
          auditId,
          actorUserId,
          'config_change',
          JSON.stringify({
            key: DELIVERY_WINDOW_CONFIG_KEY,
            newValue: stored,
          }),
          correlationId,
          ip,
          now,
        ],
      )

      await client.query('COMMIT')

      this.logger.log(
        `Delivery window set to ${config.timezone} ${config.startHour}:00–${config.endHour}:00 by ${actorUserId}`,
      )
      return config
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {})
      this.logger.error(`Failed to set delivery window config: ${String(error)}`)
      throw new HttpException(
        { statusCode: 500, error: 'INTERNAL_SERVER', message: 'Failed to update config' },
        500,
      )
    } finally {
      client.release()
    }
  }

  // ───────────────────────────────────────────────────────────────────────
  // Dual-approval threshold config (S-09.07, T-09.07.01)
  // ───────────────────────────────────────────────────────────────────────

  /**
   * Get the current admin-configurable dual-approval threshold from
   * `app_config`.
   *
   * Returns the disabled default (`thresholdIrR: 0`) when no admin value has
   * been persisted yet (T-09.07.01: a threshold of 0 means dual approval is
   * disabled and the T-09.07.02 workflow only routes financial actions into
   * Pending Approval when `thresholdIrR > 0 && amount > thresholdIrR`).
   */
  async getDualApprovalThresholdConfig(): Promise<DualApprovalConfig> {
    const pool = getDbPool()
    const result = await pool.query(
      `SELECT value FROM app_config WHERE key = $1`,
      [DUAL_APPROVAL_THRESHOLD_CONFIG_KEY],
    )
    if (result.rows.length === 0) return { ...DEFAULT_DUAL_APPROVAL_CONFIG }
    const config = toDualApprovalConfig(result.rows[0]!.value)
    // A persisted row that does not normalize to a *valid* config means the
    // stored value is corrupt; fail open to the disabled default but make the
    // corruption observable so it cannot silently disable dual approval.
    const persisted = result.rows[0]!.value as Record<string, unknown> | null
    const persistedValue = persisted?.threshold_irr ?? persisted?.thresholdIrR
    if (!isValidDualApprovalThreshold(persistedValue)) {
      this.logger.warn(
        `Dual-approval threshold config row for key ${DUAL_APPROVAL_THRESHOLD_CONFIG_KEY} is invalid (${JSON.stringify(persisted)}); serving disabled default`,
      )
    }
    return config
  }

  /**
   * Persist a new admin-configurable dual-approval threshold.
   *
   * Validates the proposal against the T-09.07.01 rules (integer IRR between
   * 0 and `Number.MAX_SAFE_INTEGER`, 0 = disabled) before writing. A failing
   * validation throws a 400 with the collected issue list so the client can
   * surface them. On success it upserts `app_config` (versioned) and bumps
   * the global config version so caches invalidate.
   *
   * @param input - raw request body ({ threshold_irr })
   * @param actorUserId - admin user performing the change (for audit)
   * @param ip - source IP (for audit)
   * @returns the persisted (camelCase) config
   */
  async setDualApprovalThresholdConfig(
    input: unknown,
    actorUserId: string,
    ip: string,
  ): Promise<DualApprovalConfig> {
    const validation = validateDualApprovalConfig(input)
    if (!validation.ok) {
      throw new HttpException(
        {
          statusCode: 400,
          error: ErrorCodes.VALIDATION_INPUT_INVALID.code,
          message: validation.issues.join('; '),
        },
        400,
      )
    }

    const config = toDualApprovalConfig(input)
    const pool = getDbPool()
    const now = new Date()

    // Persist in the snake_case shape `getDualApprovalThresholdConfig` and
    // the T-09.07.02 workflow consume.
    const stored = {
      threshold_irr: config.thresholdIrR,
    }

    const client = await pool.connect()
    try {
      await client.query('BEGIN')

      // Lock the existing row (if any) so the previous value recorded in the
      // audit trail is the true value that is being replaced — read it before
      // the upsert mutates it. Concurrent writers serialize on this row lock,
      // so no threshold change can be dropped from the audit trail.
      const prevResult = await client.query(
        `SELECT value, version FROM app_config WHERE key = $1 FOR UPDATE`,
        [DUAL_APPROVAL_THRESHOLD_CONFIG_KEY],
      )
      const previousValue =
        prevResult.rows.length > 0 ? prevResult.rows[0]!.value : null
      const previousVersion =
        prevResult.rows.length > 0 ? (prevResult.rows[0]!.version as number) : 0

      const upsertResult = await client.query(
        `INSERT INTO app_config (key, value, version, updated_at)
         VALUES ($1, $2::jsonb, 1, $3)
         ON CONFLICT (key) DO UPDATE SET value = $2::jsonb, version = app_config.version + 1, updated_at = $3
         RETURNING version`,
        [DUAL_APPROVAL_THRESHOLD_CONFIG_KEY, JSON.stringify(stored), now],
      )
      const newVersion = upsertResult.rows[0]!.version as number

      // Bump global config version for cache invalidation.
      await client.query(
        `UPDATE config_version SET version = version + 1, updated_at = $1 WHERE id = 'global'`,
        [now],
      )

      // Record audit event (config_change, matching other admin configs).
      // The audit trail captures the previous value and both version numbers
      // so a threshold change (e.g. lowering it to 0 and disabling dual
      // approval entirely) can be reconstructed end-to-end later.
      const auditId = uuidv7()
      const correlationId = uuidv7()
      await client.query(
        `INSERT INTO audit_log (id, user_id, event, metadata, correlation_id, ip, created_at)
         VALUES ($1, $2, $3, $4::jsonb, $5, $6, $7)`,
        [
          auditId,
          actorUserId,
          'config_change',
          JSON.stringify({
            key: DUAL_APPROVAL_THRESHOLD_CONFIG_KEY,
            previousValue,
            previousVersion,
            newValue: stored,
            version: newVersion,
          }),
          correlationId,
          ip,
          now,
        ],
      )

      await client.query('COMMIT')

      this.logger.log(
        `Dual-approval threshold set to IRR ${config.thresholdIrR} by ${actorUserId}`,
      )
      return config
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {})
      this.logger.error(`Failed to set dual-approval threshold config: ${String(error)}`)
      throw new HttpException(
        { statusCode: 500, error: 'INTERNAL_SERVER', message: 'Failed to update config' },
        500,
      )
    } finally {
      client.release()
    }
  }

  // ───────────────────────────────────────────────────────────────────────
  // Online wallet top-up limit config (S-09.10, T-09.10.01)
  // ───────────────────────────────────────────────────────────────────────

  /**
   * Get the current admin-configurable per-transaction online wallet top-up
   * limit from `app_config`.
   *
   * Returns the 2,000,000,000 IRR default when no admin value has been
   * persisted yet (T-09.10.01). A persisted row that does not normalize to a
   * *valid* config means the stored value is corrupt; fail open to the
   * default limit but make the corruption observable so it cannot silently
   * change the enforced ceiling.
   */
  async getWalletTopUpLimitConfig(): Promise<WalletTopUpLimitConfig> {
    const pool = getDbPool()
    const result = await pool.query(
      `SELECT value FROM app_config WHERE key = $1`,
      [WALLET_TOP_UP_LIMIT_CONFIG_KEY],
    )
    if (result.rows.length === 0) return { ...DEFAULT_WALLET_TOP_UP_LIMIT_CONFIG }
    const config = toWalletTopUpLimitConfig(result.rows[0]!.value)
    const persisted = result.rows[0]!.value as Record<string, unknown> | null
    const persistedValue = persisted?.limit_irr ?? persisted?.limitIrR
    if (!isValidWalletTopUpLimit(persistedValue)) {
      this.logger.warn(
        `Online wallet top-up limit config row for key ${WALLET_TOP_UP_LIMIT_CONFIG_KEY} is invalid (${JSON.stringify(persisted)}); serving default limit`,
      )
    }
    return config
  }

  /**
   * Persist a new admin-configurable per-transaction online wallet top-up
   * limit.
   *
   * Validates the proposal against the T-09.10.01 rules (integer IRR between
   * 0 and `Number.MAX_SAFE_INTEGER`, 0 = all online top-ups blocked) before
   * writing. A failing validation throws a 400 with the collected issue list
   * so the client can surface them. On success it upserts `app_config`
   * (versioned) and bumps the global config version so caches invalidate;
   * the audit trail records the change with the previous value and both
   * version numbers.
   *
   * @param input - raw request body ({ limit_irr })
   * @param actorUserId - admin user performing the change (for audit)
   * @param ip - source IP (for audit)
   * @returns the persisted (camelCase) config
   */
  async setWalletTopUpLimitConfig(
    input: unknown,
    actorUserId: string,
    ip: string,
  ): Promise<WalletTopUpLimitConfig> {
    const validation = validateWalletTopUpLimitConfig(input)
    if (!validation.ok) {
      throw new HttpException(
        {
          statusCode: 400,
          error: ErrorCodes.VALIDATION_INPUT_INVALID.code,
          message: validation.issues.join('; '),
        },
        400,
      )
    }

    const config = toWalletTopUpLimitConfig(input)
    const pool = getDbPool()
    const now = new Date()

    // Persist in the snake_case shape `getWalletTopUpLimitConfig` and the
    // T-04.2.02.01 online top-up flow consume.
    const stored = {
      limit_irr: config.limitIrR,
    }

    const client = await pool.connect()
    try {
      await client.query('BEGIN')

      // Lock the existing row (if any) so the previous value recorded in the
      // audit trail is the true value that is being replaced — read it before
      // the upsert mutates it. Concurrent writers serialize on this row lock,
      // so no limit change can be dropped from the audit trail.
      const prevResult = await client.query(
        `SELECT value, version FROM app_config WHERE key = $1 FOR UPDATE`,
        [WALLET_TOP_UP_LIMIT_CONFIG_KEY],
      )
      const previousValue =
        prevResult.rows.length > 0 ? prevResult.rows[0]!.value : null
      const previousVersion =
        prevResult.rows.length > 0 ? (prevResult.rows[0]!.version as number) : 0

      const upsertResult = await client.query(
        `INSERT INTO app_config (key, value, version, updated_at)
         VALUES ($1, $2::jsonb, 1, $3)
         ON CONFLICT (key) DO UPDATE SET value = $2::jsonb, version = app_config.version + 1, updated_at = $3
         RETURNING version`,
        [WALLET_TOP_UP_LIMIT_CONFIG_KEY, JSON.stringify(stored), now],
      )
      const newVersion = upsertResult.rows[0]!.version as number

      // Bump global config version for cache invalidation.
      await client.query(
        `UPDATE config_version SET version = version + 1, updated_at = $1 WHERE id = 'global'`,
        [now],
      )

      // Record audit event (config_change, matching other admin configs).
      // The audit trail captures the previous value and both version numbers
      // so a limit change can be reconstructed end-to-end later.
      const auditId = uuidv7()
      const correlationId = uuidv7()
      await client.query(
        `INSERT INTO audit_log (id, user_id, event, metadata, correlation_id, ip, created_at)
         VALUES ($1, $2, $3, $4::jsonb, $5, $6, $7)`,
        [
          auditId,
          actorUserId,
          'config_change',
          JSON.stringify({
            key: WALLET_TOP_UP_LIMIT_CONFIG_KEY,
            previousValue,
            previousVersion,
            newValue: stored,
            version: newVersion,
          }),
          correlationId,
          ip,
          now,
        ],
      )

      await client.query('COMMIT')

      this.logger.log(
        `Online wallet top-up limit set to IRR ${config.limitIrR} by ${actorUserId}`,
      )
      return config
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {})
      this.logger.error(`Failed to set online wallet top-up limit config: ${String(error)}`)
      throw new HttpException(
        { statusCode: 500, error: 'INTERNAL_SERVER', message: 'Failed to update config' },
        500,
      )
    } finally {
      client.release()
    }
  }

  // ───────────────────────────────────────────────────────────────────────
  // Mandatory green-electricity rules (S-09.10, T-09.10.02)
  // ───────────────────────────────────────────────────────────────────────

  /**
   * Get the current admin-configurable mandatory green-electricity rules
   * from `app_config`.
   *
   * Returns the T-09.10.02 defaults (simple enabled, advanced disabled,
   * 1000 kW threshold, 4% share) when no admin value has been persisted
   * yet. A persisted row that does not normalize to a *valid* config is
   * warned about and served as the defaults — a corrupt value must not crash
   * the read path or silently change the enforced rule. The product-state
   * fail-closed safety check (T-09.10.03) is out of scope for this slice.
   */
  async getGreenElectricityConfig(): Promise<GreenElectricityConfig> {
    const pool = getDbPool()
    const result = await pool.query(
      `SELECT value FROM app_config WHERE key = $1`,
      [GREEN_ELECTRICITY_CONFIG_KEY],
    )
    if (result.rows.length === 0) return { ...DEFAULT_GREEN_ELECTRICITY_CONFIG }
    const persisted = result.rows[0]!.value as Record<string, unknown> | null
    // The stored snake_case shape must itself validate; a malformed row (wrong
    // types, missing modes) is surfaced rather than silently served as a
    // confusing mix of persisted + default fields.
    const validation = validateGreenElectricityConfig(persisted)
    if (!validation.ok) {
      this.logger.warn(
        `Green electricity config row for key ${GREEN_ELECTRICITY_CONFIG_KEY} is invalid (${JSON.stringify(persisted)}); serving defaults`,
      )
      return { ...DEFAULT_GREEN_ELECTRICITY_CONFIG }
    }
    return toGreenElectricityConfig(persisted)
  }

  /**
   * Persist new admin-configurable mandatory green-electricity rules.
   *
   * Validates the proposal against the T-09.10.02 rules (both mode objects
   * present; boolean enable flags; integer threshold >= 0; share in 0..100)
   * before writing. A failing validation throws a 400 with the collected
   * issue list. On success it upserts `app_config` (versioned) and bumps the
   * global config version so caches invalidate; the audit trail records the
   * change with the previous value and both version numbers. Changes affect
   * new orders only (existing orders retain their confirmation snapshot) —
   * no retroactive enforcement is performed here.
   *
   * @param input - raw request body ({ simple_order, advanced_order })
   * @param actorUserId - admin user performing the change (for audit)
   * @param ip - source IP (for audit)
   * @returns the persisted (camelCase) config
   */
  async setGreenElectricityConfig(
    input: unknown,
    actorUserId: string,
    ip: string,
  ): Promise<GreenElectricityConfig> {
    const validation = validateGreenElectricityConfig(input)
    if (!validation.ok) {
      throw new HttpException(
        {
          statusCode: 400,
          error: ErrorCodes.VALIDATION_INPUT_INVALID.code,
          message: validation.issues.join('; '),
        },
        400,
      )
    }

    const config = toGreenElectricityConfig(input)

    // T-09.10.03 — Activation safety gate. A mode may only be saved with the
    // rule enabled if the green electricity product can actually support it
    // (exists, active, priced). If any mode ends up enabled while the product
    // is not activatable we refuse to persist, so a mandatory-green rule can
    // never be activated against an unsupported product. The gate shares the
    // fail-closed policy with the safety-status endpoint via the
    // evaluateGreenRuleEnforcement seam. Note: the product row is read before
    // the transaction opens; post-save drift (product deactivated after this
    // check) is handled by the ordering engine consulting the seam's
    // `blocked` flag and by the admin-facing safety-status path, not by
    // retrying this write.
    const productState = await this.getGreenElectricityProductState()
    for (const mode of GREEN_ELECTRICITY_ORDER_MODES) {
      const enforcement = evaluateGreenRuleEnforcement(config, mode, productState)
      if (!enforcement.blocked) continue
      const modeLabel = mode === 'simpleOrder' ? 'simple' : 'advanced'
      throw new HttpException(
        {
          statusCode: 400,
          error: ErrorCodes.VALIDATION_INPUT_INVALID.code,
          message: `Cannot activate: Green electricity product is ${enforcement.reasons.join(' and ')} for the ${modeLabel} order rule. Fix the product state or disable the rule.`,
          details: { mode, reasons: [...enforcement.reasons] },
        },
        400,
      )
    }

    const pool = getDbPool()
    const now = new Date()
    const stored = greenElectricityConfigToStored(config)

    const client = await pool.connect()
    try {
      await client.query('BEGIN')

      // Lock the existing row (if any) so the previous value recorded in the
      // audit trail is the true value being replaced. Concurrent writers
      // serialize on this row lock, so no rule change can be dropped from the
      // audit trail.
      const prevResult = await client.query(
        `SELECT value, version FROM app_config WHERE key = $1 FOR UPDATE`,
        [GREEN_ELECTRICITY_CONFIG_KEY],
      )
      const previousValue =
        prevResult.rows.length > 0 ? prevResult.rows[0]!.value : null
      const previousVersion =
        prevResult.rows.length > 0 ? (prevResult.rows[0]!.version as number) : 0

      const upsertResult = await client.query(
        `INSERT INTO app_config (key, value, version, updated_at)
         VALUES ($1, $2::jsonb, 1, $3)
         ON CONFLICT (key) DO UPDATE SET value = $2::jsonb, version = app_config.version + 1, updated_at = $3
         RETURNING version`,
        [GREEN_ELECTRICITY_CONFIG_KEY, JSON.stringify(stored), now],
      )
      const newVersion = upsertResult.rows[0]!.version as number

      // Bump global config version for cache invalidation.
      await client.query(
        `UPDATE config_version SET version = version + 1, updated_at = $1 WHERE id = 'global'`,
        [now],
      )

      // Record audit event (config_change, matching other admin configs).
      const auditId = uuidv7()
      const correlationId = uuidv7()
      await client.query(
        `INSERT INTO audit_log (id, user_id, event, metadata, correlation_id, ip, created_at)
         VALUES ($1, $2, $3, $4::jsonb, $5, $6, $7)`,
        [
          auditId,
          actorUserId,
          'config_change',
          JSON.stringify({
            key: GREEN_ELECTRICITY_CONFIG_KEY,
            previousValue,
            previousVersion,
            newValue: stored,
            version: newVersion,
          }),
          correlationId,
          ip,
          now,
        ],
      )

      await client.query('COMMIT')

      this.logger.log(
        `Mandatory green-electricity rules updated by ${actorUserId}`,
      )
      return config
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {})
      this.logger.error(`Failed to set green electricity config: ${String(error)}`)
      throw new HttpException(
        { statusCode: 500, error: 'INTERNAL_SERVER', message: 'Failed to update config' },
        500,
      )
    } finally {
      client.release()
    }
  }

  /**
   * Read the current state of the system `green_electricity` product from the
   * `products` table. Absent row and missing/unpriced/zero price are all
   * modelled explicitly so the activation and fail-closed checks can reason
   * about them.
   */
  async getGreenElectricityProductState(): Promise<GreenElectricityProductState> {
    const pool = getDbPool()
    const result = await pool.query(
      `SELECT status, price FROM products WHERE system_key = $1`,
      [GREEN_ELECTRICITY_SYSTEM_KEY],
    )
    if (result.rows.length === 0) {
      return { exists: false, status: null, priceIrR: null }
    }
    const row = result.rows[0] as { status: string; price: string | number | null }
    // node-pg returns NUMERIC/BIGINT as string, but be defensive: any
    // non-finite coercion maps to `null` (unpriced) so a corrupt value can
    // never pass the activation gate as if it were priced (fail-closed).
    const parsedPrice = row.price === null ? null : Number(row.price)
    return {
      exists: true,
      status:
        row.status === 'active' || row.status === 'inactive' || row.status === 'archived'
          ? row.status
          : 'inactive',
      priceIrR: parsedPrice !== null && Number.isFinite(parsedPrice) ? parsedPrice : null,
    }
  }

  /**
   * T-09.10.03 — Green rule activation/safety status for both order modes.
   *
   * Evaluated fresh against the persisted green config and the current green
   * product state. Used by the admin UI to alert when an active rule has
   * become unenforceable (fail-closed: `blocked` true means ordering must be
   * prevented until the product is fixed or the rule disabled), and by any
   * consumer that needs the enforcement seam.
   */
  async getGreenElectricitySafetyStatus(): Promise<{
    product: GreenElectricityProductState
    simpleOrder: { ruleActive: boolean; blocked: boolean; reasons: string[] }
    advancedOrder: { ruleActive: boolean; blocked: boolean; reasons: string[] }
  }> {
    const [config, productState] = await Promise.all([
      this.getGreenElectricityConfig(),
      this.getGreenElectricityProductState(),
    ])
    const simpleOrder = evaluateGreenRuleEnforcement(config, 'simpleOrder', productState)
    const advancedOrder = evaluateGreenRuleEnforcement(config, 'advancedOrder', productState)
    return {
      product: productState,
      simpleOrder: { ...simpleOrder, reasons: [...simpleOrder.reasons] },
      advancedOrder: { ...advancedOrder, reasons: [...advancedOrder.reasons] },
    }
  }

  // ───────────────────────────────────────────────────────────────────────
  // Service response targets (S-09.08, T-09.08.01)
  // ───────────────────────────────────────────────────────────────────────

  /**
   * Get the current admin-configurable service response targets from
   * `app_config`.
   *
   * Returns the all-disabled default (every service type `null`) when no
   * admin value has been persisted yet, so a fresh installation never fires
   * breach alerts for pre-existing open items. A persisted row that does not
   * normalize cleanly is warned about and served as the defaults — a corrupt
   * value can disable breach detection but must not crash the read path or
   * silently mean "alert everything immediately".
   */
  async getServiceResponseTargets(): Promise<ServiceResponseTargets> {
    const pool = getDbPool()
    const result = await pool.query(
      `SELECT value FROM app_config WHERE key = $1`,
      [SERVICE_RESPONSE_TARGETS_CONFIG_KEY],
    )
    if (result.rows.length === 0) {
      return { ...DEFAULT_SERVICE_RESPONSE_TARGETS }
    }
    const persisted = result.rows[0]!.value as Record<string, unknown> | null
    const config = toServiceResponseTargets(persisted)
    // Detect corruption: any catalog type whose stored value survived
    // normalization differently than it was stored means the row is corrupt.
    const corrupt = SERVICE_RESPONSE_TARGET_TYPES.some((type) => {
      const raw = persisted?.[type] ?? null
      return raw === null ? config[type] !== null : config[type] !== raw
    })
    if (corrupt) {
      this.logger.warn(
        `Service response targets config row for key ${SERVICE_RESPONSE_TARGETS_CONFIG_KEY} is invalid (${JSON.stringify(persisted)}); serving per-type normalized values (corrupt types disabled)`,
      )
    }
    return config
  }

  /**
   * Persist a new admin-configurable service response target map.
   *
   * Validates the proposal against the T-09.08.01 rules (known service types
   * only; values `null` or integer hours within 1…8760) before writing. A
   * failing validation throws a 400 with the collected issue list so the
   * client can surface them. The map is a full replace: types omitted from
   * the payload become `null` (disabled). On success it upserts `app_config`
   * (versioned), bumps the global config version so caches invalidate, and
   * records a `config_change` audit event with the previous value and both
   * version numbers.
   *
   * @param input - raw request body (flat map, e.g. `{ ticket: 48 }`)
   * @param actorUserId - admin user performing the change (for audit)
   * @param ip - source IP (for audit)
   * @returns the persisted (normalized) targets map
   */
  async setServiceResponseTargets(
    input: unknown,
    actorUserId: string,
    ip: string,
  ): Promise<ServiceResponseTargets> {
    const validation = validateServiceResponseTargets(input)
    if (!validation.ok) {
      throw new HttpException(
        {
          statusCode: 400,
          error: ErrorCodes.VALIDATION_INPUT_INVALID.code,
          message: validation.issues.join('; '),
        },
        400,
      )
    }

    const config = toServiceResponseTargets(input)
    const pool = getDbPool()
    const now = new Date()

    const client = await pool.connect()
    try {
      await client.query('BEGIN')

      // Lock the existing row (if any) so the previous value recorded in the
      // audit trail is the true value being replaced — read it before the
      // upsert mutates it. Concurrent writers serialize on this row lock, so
      // no target change can be dropped from the audit trail.
      const prevResult = await client.query(
        `SELECT value, version FROM app_config WHERE key = $1 FOR UPDATE`,
        [SERVICE_RESPONSE_TARGETS_CONFIG_KEY],
      )
      const previousValue =
        prevResult.rows.length > 0 ? prevResult.rows[0]!.value : null
      const previousVersion =
        prevResult.rows.length > 0 ? (prevResult.rows[0]!.version as number) : 0

      const upsertResult = await client.query(
        `INSERT INTO app_config (key, value, version, updated_at)
         VALUES ($1, $2::jsonb, 1, $3)
         ON CONFLICT (key) DO UPDATE SET value = $2::jsonb, version = app_config.version + 1, updated_at = $3
         RETURNING version`,
        [SERVICE_RESPONSE_TARGETS_CONFIG_KEY, JSON.stringify(config), now],
      )
      const newVersion = upsertResult.rows[0]!.version as number

      // Bump global config version for cache invalidation.
      await client.query(
        `UPDATE config_version SET version = version + 1, updated_at = $1 WHERE id = 'global'`,
        [now],
      )

      // Record audit event (config_change, matching other admin configs).
      // The trail captures the previous value and both version numbers so a
      // target change (including disabling a type) can be reconstructed
      // end-to-end later.
      const auditId = uuidv7()
      const correlationId = uuidv7()
      await client.query(
        `INSERT INTO audit_log (id, user_id, event, metadata, correlation_id, ip, created_at)
         VALUES ($1, $2, $3, $4::jsonb, $5, $6, $7)`,
        [
          auditId,
          actorUserId,
          'config_change',
          JSON.stringify({
            key: SERVICE_RESPONSE_TARGETS_CONFIG_KEY,
            previousValue,
            previousVersion,
            newValue: config,
            version: newVersion,
          }),
          correlationId,
          ip,
          now,
        ],
      )

      await client.query('COMMIT')

      this.logger.log(
        `Service response targets set to ${JSON.stringify(config)} by ${actorUserId}`,
      )
      return config
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {})
      this.logger.error(`Failed to set service response targets config: ${String(error)}`)
      throw new HttpException(
        { statusCode: 500, error: 'INTERNAL_SERVER', message: 'Failed to update config' },
        500,
      )
    } finally {
      client.release()
    }
  }

  // ───────────────────────────────────────────────────────────────────────
  // Service escalation policy (S-09.08, T-09.08.03)
  // ───────────────────────────────────────────────────────────────────────

  /**
   * Get the current admin-configurable service escalation policy from
   * `app_config`.
   *
   * Returns the all-disabled default (every service type `null`) when no
   * admin value has been persisted yet, so a fresh installation never
   * escalates any item. A persisted row that does not normalize cleanly is
   * warned about and served per-type normalized — a corrupt value can
   * disable escalation for a type or a level but must not crash the read
   * path.
   */
  async getEscalationPolicy(): Promise<EscalationPolicies> {
    const pool = getDbPool()
    const result = await pool.query(
      `SELECT value FROM app_config WHERE key = $1`,
      [ESCALATION_POLICY_CONFIG_KEY],
    )
    if (result.rows.length === 0) {
      return structuredClone(DEFAULT_ESCALATION_POLICIES)
    }
    const persisted = result.rows[0]!.value as Record<string, unknown> | null
    const config = toEscalationPolicies(persisted)
    // Corruption detection: any known service type whose stored value
    // survived normalization differently than it was stored means the row
    // is corrupt. (Level sub-values are compared structurally via JSON.)
    const corrupt = SERVICE_RESPONSE_TARGET_TYPES.some((type) => {
      const stored = (persisted ?? {})[type] ?? null
      return JSON.stringify(stored) !== JSON.stringify(config[type])
    })
    if (corrupt) {
      this.logger.warn(
        `Escalation policy config row for key ${ESCALATION_POLICY_CONFIG_KEY} is invalid (${JSON.stringify(persisted)}); serving per-type normalized values (corrupt types/levels disabled)`,
      )
    }
    return config
  }

  /**
   * Persist a new admin-configurable service escalation policy.
   *
   * Validates the proposal against the T-09.08.03 rules (known service types
   * only; each type's `level2`/`level3` has a valid delay and channel set)
   * before writing. A failing validation throws a 400 with the collected
   * issue list so the client can surface them. The map is a full replace:
   * types omitted from the payload become `null` (escalation disabled). On
   * success it upserts `app_config` (versioned), bumps the global config
   * version so caches invalidate, and records a `config_change` audit event
   * with the previous value and both version numbers.
   *
   * @param input - raw request body (map of service type → policy or null)
   * @param actorUserId - admin user performing the change (for audit)
   * @param ip - source IP (for audit)
   * @returns the persisted (normalized) escalation policy map
   */
  async setEscalationPolicy(
    input: unknown,
    actorUserId: string,
    ip: string,
  ): Promise<EscalationPolicies> {
    const validation = validateEscalationPolicies(input)
    if (!validation.ok) {
      throw new HttpException(
        {
          statusCode: 400,
          error: ErrorCodes.VALIDATION_INPUT_INVALID.code,
          message: validation.issues.join('; '),
        },
        400,
      )
    }

    const config = toEscalationPolicies(input)
    const pool = getDbPool()
    const now = new Date()

    const client = await pool.connect()
    try {
      await client.query('BEGIN')

      // Lock the existing row (if any) so the previous value recorded in the
      // audit trail is the true value being replaced — read it before the
      // upsert mutates it. Concurrent writers serialize on this row lock.
      const prevResult = await client.query(
        `SELECT value, version FROM app_config WHERE key = $1 FOR UPDATE`,
        [ESCALATION_POLICY_CONFIG_KEY],
      )
      const previousValue =
        prevResult.rows.length > 0 ? prevResult.rows[0]!.value : null
      const previousVersion =
        prevResult.rows.length > 0 ? (prevResult.rows[0]!.version as number) : 0

      const upsertResult = await client.query(
        `INSERT INTO app_config (key, value, version, updated_at)
         VALUES ($1, $2::jsonb, 1, $3)
         ON CONFLICT (key) DO UPDATE SET value = $2::jsonb, version = app_config.version + 1, updated_at = $3
         RETURNING version`,
        [ESCALATION_POLICY_CONFIG_KEY, JSON.stringify(config), now],
      )
      const newVersion = upsertResult.rows[0]!.version as number

      // Bump global config version for cache invalidation.
      await client.query(
        `UPDATE config_version SET version = version + 1, updated_at = $1 WHERE id = 'global'`,
        [now],
      )

      // Record audit event (config_change, matching other admin configs).
      const auditId = uuidv7()
      const correlationId = uuidv7()
      await client.query(
        `INSERT INTO audit_log (id, user_id, event, metadata, correlation_id, ip, created_at)
         VALUES ($1, $2, $3, $4::jsonb, $5, $6, $7)`,
        [
          auditId,
          actorUserId,
          'config_change',
          JSON.stringify({
            key: ESCALATION_POLICY_CONFIG_KEY,
            previousValue,
            previousVersion,
            newValue: config,
            version: newVersion,
          }),
          correlationId,
          ip,
          now,
        ],
      )

      await client.query('COMMIT')

      this.logger.log(
        `Service escalation policy set to ${JSON.stringify(config)} by ${actorUserId}`,
      )
      return config
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {})
      this.logger.error(`Failed to set escalation policy config: ${String(error)}`)
      throw new HttpException(
        { statusCode: 500, error: 'INTERNAL_SERVER', message: 'Failed to update config' },
        500,
      )
    } finally {
      client.release()
    }
  }

  // ───────────────────────────────────────────────────────────────────────
  // Staff teams and assignment rules (S-09.08, T-09.08.02)
  // ───────────────────────────────────────────────────────────────────────

  /**
   * Get the current admin-configurable staff assignment rules from
   * `app_config`.
   *
   * Returns the all-manual default (every work type `teamId: null`) when no
   * admin value has been persisted yet, so a fresh installation never
   * auto-assigns work. A persisted row that does not normalize cleanly is
   * warned about and served per-type normalized — a corrupt value can
   * disable auto-assignment for a work type but must not crash the read
   * path.
   */
  async getStaffAssignmentRules(): Promise<StaffAssignmentRules> {
    const pool = getDbPool()
    const result = await pool.query(
      `SELECT value FROM app_config WHERE key = $1`,
      [STAFF_ASSIGNMENT_RULES_CONFIG_KEY],
    )
    if (result.rows.length === 0) {
      return structuredClone(DEFAULT_STAFF_ASSIGNMENT_RULES)
    }
    const persisted = result.rows[0]!.value as Record<string, unknown> | null
    const config = toStaffAssignmentRules(persisted)
    // Detect corruption: any work type whose stored rule survived
    // normalization differently than it was stored means the row is corrupt.
    const corrupt = Object.keys(persisted ?? {}).some((workType) => {
      const raw = (persisted as Record<string, unknown>)[workType]
      if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return true
      const rule = raw as Record<string, unknown>
      const normalized = config[workType as keyof StaffAssignmentRules]
      // Unknown work type (not in STAFF_ASSIGNMENT_WORK_TYPES): treat as
      // corrupt rather than crashing on the undefined dereference below.
      if (!normalized) return true
      return normalized.teamId !== rule.teamId ||
        (typeof rule.strategy === 'string' && normalized.strategy !== rule.strategy)
    })
    if (corrupt) {
      this.logger.warn(
        `Staff assignment rules config row for key ${STAFF_ASSIGNMENT_RULES_CONFIG_KEY} is invalid (${JSON.stringify(persisted)}); serving per-type normalized values (corrupt work types fall back to manual assignment)`,
      )
    }
    return config
  }

  /**
   * Persist a new admin-configurable staff assignment rules map.
   *
   * Validates the proposal against the T-09.08.02 rules (known work types
   * only; each rule has a `teamId` string/null and a valid strategy) before
   * writing. A failing validation throws a 400 with the collected issue
   * list. The map is a full replace: work types omitted from the payload
   * become manual assignment. On success it upserts `app_config`
   * (versioned), bumps the global config version so caches invalidate, and
   * records a `config_change` audit event with the previous value and both
   * version numbers.
   *
   * The teamId reference is not resolved here — a rule may name a team that
   * is created later, and the assignment engine (future slice) resolves it
   * at assignment time, skipping auto-assignment for unknown/disabled teams.
   *
   * @param input - raw request body (flat map, e.g. `{ ticket: { teamId: '…', strategy: 'round_robin' } }`)
   * @param actorUserId - admin user performing the change (for audit)
   * @param ip - source IP (for audit)
   * @returns the persisted (normalized) assignment rules map
   */
  async setStaffAssignmentRules(
    input: unknown,
    actorUserId: string,
    ip: string,
  ): Promise<StaffAssignmentRules> {
    const validation = validateStaffAssignmentRules(input)
    if (!validation.ok) {
      throw new HttpException(
        {
          statusCode: 400,
          error: ErrorCodes.VALIDATION_INPUT_INVALID.code,
          message: validation.issues.join('; '),
        },
        400,
      )
    }

    const config = toStaffAssignmentRules(input)
    const pool = getDbPool()
    const now = new Date()

    const client = await pool.connect()
    try {
      await client.query('BEGIN')

      const prevResult = await client.query(
        `SELECT value, version FROM app_config WHERE key = $1 FOR UPDATE`,
        [STAFF_ASSIGNMENT_RULES_CONFIG_KEY],
      )
      const previousValue =
        prevResult.rows.length > 0 ? prevResult.rows[0]!.value : null
      const previousVersion =
        prevResult.rows.length > 0 ? (prevResult.rows[0]!.version as number) : 0

      const upsertResult = await client.query(
        `INSERT INTO app_config (key, value, version, updated_at)
         VALUES ($1, $2::jsonb, 1, $3)
         ON CONFLICT (key) DO UPDATE SET value = $2::jsonb, version = app_config.version + 1, updated_at = $3
         RETURNING version`,
        [STAFF_ASSIGNMENT_RULES_CONFIG_KEY, JSON.stringify(config), now],
      )
      const newVersion = upsertResult.rows[0]!.version as number

      // Bump global config version for cache invalidation.
      await client.query(
        `UPDATE config_version SET version = version + 1, updated_at = $1 WHERE id = 'global'`,
        [now],
      )

      const auditId = uuidv7()
      const correlationId = uuidv7()
      await client.query(
        `INSERT INTO audit_log (id, user_id, event, metadata, correlation_id, ip, created_at)
         VALUES ($1, $2, $3, $4::jsonb, $5, $6, $7)`,
        [
          auditId,
          actorUserId,
          'config_change',
          JSON.stringify({
            key: STAFF_ASSIGNMENT_RULES_CONFIG_KEY,
            previousValue,
            previousVersion,
            newValue: config,
            version: newVersion,
          }),
          correlationId,
          ip,
          now,
        ],
      )

      await client.query('COMMIT')

      this.logger.log(
        `Staff assignment rules set to ${JSON.stringify(config)} by ${actorUserId}`,
      )
      return config
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {})
      this.logger.error(`Failed to set staff assignment rules config: ${String(error)}`)
      throw new HttpException(
        { statusCode: 500, error: 'INTERNAL_SERVER', message: 'Failed to update config' },
        500,
      )
    } finally {
      client.release()
    }
  }

  /**
   * List all staff teams with their member user ids (T-09.08.02).
   *
   * Returns teams ordered by name. Each team carries `memberUserIds` (the
   * users currently in the team, ordered by membership created_at) so the
   * admin surface can render member management without a second call.
   */
  async listStaffTeams(): Promise<StaffTeamRecord[]> {
    const pool = getDbPool()
    const teamsResult = await pool.query(
      `SELECT id, name, description, skill_tags, is_active, created_at, updated_at
       FROM staff_teams
       ORDER BY name ASC`,
    )
    if (teamsResult.rows.length === 0) return []

    const membersResult = await pool.query(
      `SELECT team_id, user_id
       FROM staff_team_members
       WHERE team_id = ANY($1::uuid[])
       ORDER BY created_at ASC`,
      [teamsResult.rows.map((r: { id: string }) => r.id)],
    )

    const membersByTeam = new Map<string, string[]>()
    for (const row of membersResult.rows as { team_id: string; user_id: string }[]) {
      const list = membersByTeam.get(row.team_id) ?? []
      list.push(row.user_id)
      membersByTeam.set(row.team_id, list)
    }

    return teamsResult.rows.map((row: { id: string; name: string; description: string | null; skill_tags: unknown; is_active: boolean; created_at: Date; updated_at: Date }) => ({
      id: row.id,
      name: row.name,
      description: row.description,
      skillTags: Array.isArray(row.skill_tags) ? (row.skill_tags as string[]) : [],
      isActive: row.is_active,
      memberUserIds: membersByTeam.get(row.id) ?? [],
      createdAt: row.created_at.toISOString(),
      updatedAt: row.updated_at.toISOString(),
    }))
  }

  /**
   * Create a staff team (T-09.08.02).
   *
   * Validates the input (name/skill-tags/member shape), verifies every
   * member user id exists, inserts the team row and its membership in one
   * transaction, and records a `team_create` audit event. A duplicate team
   * name surfaces as a 409.
   *
   * @param input - raw request body (`{ name, description?, skillTags?, memberUserIds? }`)
   * @param actorUserId - admin user performing the change (for audit)
   * @param ip - source IP (for audit)
   * @returns the created team record
   */
  async createStaffTeam(
    input: unknown,
    actorUserId: string,
    ip: string,
  ): Promise<StaffTeamRecord> {
    const validation = validateStaffTeamInput(input)
    if (!validation.ok) {
      throw new HttpException(
        {
          statusCode: 400,
          error: ErrorCodes.VALIDATION_INPUT_INVALID.code,
          message: validation.issues.join('; '),
        },
        400,
      )
    }

    const team: StaffTeamInput = {
      name: (input as StaffTeamInput).name.trim(),
      description: ((input as StaffTeamInput).description ?? null) as string | null,
      skillTags: ((input as StaffTeamInput).skillTags ?? []).map((t: string) => t.trim()),
      memberUserIds: (input as StaffTeamInput).memberUserIds ?? [],
    }

    const pool = getDbPool()
    const client = await pool.connect()
    const now = new Date()
    const teamId = uuidv7()

    try {
      await client.query('BEGIN')

      await this.assertTeamMembersExist(client, team.memberUserIds)

      const insertResult = await client.query(
        `INSERT INTO staff_teams (id, name, description, skill_tags, is_active, created_at, updated_at)
         VALUES ($1, $2, $3, $4::jsonb, true, $5, $5)
         RETURNING id, name, description, skill_tags, is_active, created_at, updated_at`,
        [teamId, team.name, team.description, JSON.stringify(team.skillTags), now],
      )
      const row = insertResult.rows[0]!

      await this.insertTeamMembers(client, teamId, team.memberUserIds, now)

      await this.recordTeamAudit(client, 'team_create', actorUserId, ip, now, {
        teamId,
        name: team.name,
        memberUserIds: team.memberUserIds,
        skillTags: team.skillTags,
      })

      await client.query('COMMIT')

      this.logger.log(`Staff team '${team.name}' (${teamId}) created by ${actorUserId}`)
      return this.mapTeamRow(row, team.memberUserIds)
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {})
      if (error instanceof HttpException) throw error
      if (this.isUniqueViolation(error, 'uq_st_name')) {
        throw new HttpException(
          {
            statusCode: 409,
            error: 'TEAM_NAME_TAKEN',
            message: `A staff team named '${team.name}' already exists`,
          },
          409,
        )
      }
      this.logger.error(`Failed to create staff team '${team.name}': ${String(error)}`)
      throw new HttpException(
        { statusCode: 500, error: 'INTERNAL_SERVER', message: 'Failed to create staff team' },
        500,
      )
    } finally {
      client.release()
    }
  }

  /**
   * Update a staff team (T-09.08.02).
   *
   * Validates against the same rules as create, verifies every member user
   * id exists, replaces the team's row and membership set in one transaction,
   * and records a `team_update` audit event with the previous snapshot.
   *
   * @param teamId - the team's UUID
   * @param input - raw request body (partial allowed: `{ name?, description?, skillTags?, memberUserIds? }`)
   * @param actorUserId - admin user performing the change (for audit)
   * @param ip - source IP (for audit)
   * @returns the updated team record
   */
  async updateStaffTeam(
    teamId: string,
    input: unknown,
    actorUserId: string,
    ip: string,
  ): Promise<StaffTeamRecord> {
    const pool = getDbPool()
    const client = await pool.connect()
    const now = new Date()

    try {
      await client.query('BEGIN')

      const existingResult = await client.query(
        `SELECT id, name, description, skill_tags, is_active, created_at, updated_at
         FROM staff_teams WHERE id = $1 FOR UPDATE`,
        [teamId],
      )
      if (existingResult.rows.length === 0) {
        throw new HttpException(
          { statusCode: 404, error: 'TEAM_NOT_FOUND', message: 'Staff team not found' },
          404,
        )
      }
      const existing = existingResult.rows[0]!

      const prevMembersResult = await client.query(
        `SELECT user_id FROM staff_team_members WHERE team_id = $1 ORDER BY created_at ASC`,
        [teamId],
      )
      const previousMemberUserIds = prevMembersResult.rows.map((r: { user_id: string }) => r.user_id)

      // Normalize the update: merge provided fields with existing values,
      // then run the full validator over the merged shape so a partial
      // update cannot bypass a rule (e.g. name length).
      const merged: StaffTeamInput = {
        name: (input as Record<string, unknown>).name !== undefined
          ? ((input as Record<string, unknown>).name as string)
          : existing.name,
        description: (input as Record<string, unknown>).description !== undefined
          ? ((input as Record<string, unknown>).description as string | null)
          : (existing.description as string | null),
        skillTags: (input as Record<string, unknown>).skillTags !== undefined
          ? ((input as Record<string, unknown>).skillTags as string[])
          : (Array.isArray(existing.skill_tags) ? (existing.skill_tags as string[]) : []),
        memberUserIds: (input as Record<string, unknown>).memberUserIds !== undefined
          ? ((input as Record<string, unknown>).memberUserIds as string[])
          : previousMemberUserIds,
      }

      const validation = validateStaffTeamInput(merged)
      if (!validation.ok) {
        throw new HttpException(
          {
            statusCode: 400,
            error: ErrorCodes.VALIDATION_INPUT_INVALID.code,
            message: validation.issues.join('; '),
          },
          400,
        )
      }

      // Post-validation normalization mirrors createStaffTeam: trim the name
      // and each skill tag so both endpoints store identical shapes.
      merged.name = merged.name.trim()
      merged.skillTags = merged.skillTags.map((t: string) => t.trim())

      await this.assertTeamMembersExist(client, merged.memberUserIds)

      const updateResult = await client.query(
        `UPDATE staff_teams
         SET name = $2, description = $3, skill_tags = $4::jsonb, updated_at = $5
         WHERE id = $1
         RETURNING id, name, description, skill_tags, is_active, created_at, updated_at`,
        [teamId, merged.name, merged.description, JSON.stringify(merged.skillTags), now],
      )
      const row = updateResult.rows[0]!

      // Replace membership set (delete stale, insert new).
      await client.query(`DELETE FROM staff_team_members WHERE team_id = $1`, [teamId])
      await this.insertTeamMembers(client, teamId, merged.memberUserIds, now)

      await this.recordTeamAudit(client, 'team_update', actorUserId, ip, now, {
        teamId,
        name: merged.name,
        previousName: existing.name,
        previousMemberUserIds,
        memberUserIds: merged.memberUserIds,
        previousSkillTags: Array.isArray(existing.skill_tags) ? existing.skill_tags : [],
        skillTags: merged.skillTags,
      })

      await client.query('COMMIT')

      this.logger.log(`Staff team '${merged.name}' (${teamId}) updated by ${actorUserId}`)
      return this.mapTeamRow(row, merged.memberUserIds)
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {})
      if (error instanceof HttpException) throw error
      if (this.isUniqueViolation(error, 'uq_st_name')) {
        throw new HttpException(
          {
            statusCode: 409,
            error: 'TEAM_NAME_TAKEN',
            message: `A staff team named '${(input as Record<string, unknown>).name}' already exists`,
          },
          409,
        )
      }
      this.logger.error(`Failed to update staff team ${teamId}: ${String(error)}`)
      throw new HttpException(
        { statusCode: 500, error: 'INTERNAL_SERVER', message: 'Failed to update staff team' },
        500,
      )
    } finally {
      client.release()
    }
  }

  /**
   * Delete a staff team (T-09.08.02).
   *
   * Removes the team row and its memberships (ON DELETE CASCADE) and
   * records a `team_delete` audit event. Assignment rules referencing this
   * team are left untouched — the assignment engine treats unknown/disabled
   * teams as manual assignment, so a deleted team cannot break the worker.
   *
   * @param teamId - the team's UUID
   * @param actorUserId - admin user performing the change (for audit)
   * @param ip - source IP (for audit)
   */
  async deleteStaffTeam(teamId: string, actorUserId: string, ip: string): Promise<{ deleted: true }> {
    const pool = getDbPool()
    const client = await pool.connect()
    const now = new Date()

    try {
      await client.query('BEGIN')

      const existingResult = await client.query(
        `SELECT id, name FROM staff_teams WHERE id = $1 FOR UPDATE`,
        [teamId],
      )
      if (existingResult.rows.length === 0) {
        throw new HttpException(
          { statusCode: 404, error: 'TEAM_NOT_FOUND', message: 'Staff team not found' },
          404,
        )
      }
      const existing = existingResult.rows[0]!

      await client.query(`DELETE FROM staff_teams WHERE id = $1`, [teamId])

      await this.recordTeamAudit(client, 'team_delete', actorUserId, ip, now, {
        teamId,
        name: existing.name,
      })

      await client.query('COMMIT')

      this.logger.log(`Staff team '${existing.name}' (${teamId}) deleted by ${actorUserId}`)
      return { deleted: true }
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {})
      if (error instanceof HttpException) throw error
      this.logger.error(`Failed to delete staff team ${teamId}: ${String(error)}`)
      throw new HttpException(
        { statusCode: 500, error: 'INTERNAL_SERVER', message: 'Failed to delete staff team' },
        500,
      )
    } finally {
      client.release()
    }
  }

  // ── Staff team helpers ──────────────────────────────────────────────

  private async assertTeamMembersExist(
    client: { query: (sql: string, params?: unknown[]) => Promise<{ rows: unknown[] }> },
    memberUserIds: string[],
  ): Promise<void> {
    if (memberUserIds.length === 0) return
    const result = await client.query(
      `SELECT user_id FROM users WHERE user_id = ANY($1::text[])`,
      [memberUserIds],
    )
    const found = new Set((result.rows as { user_id: string }[]).map((r) => r.user_id))
    const missing = memberUserIds.filter((id) => !found.has(id))
    if (missing.length > 0) {
      throw new HttpException(
        {
          statusCode: 400,
          error: 'MEMBER_USER_NOT_FOUND',
          message: `Unknown member user id(s): ${missing.join(', ')}`,
        },
        400,
      )
    }
  }

  private async insertTeamMembers(
    client: { query: (sql: string, params?: unknown[]) => Promise<unknown> },
    teamId: string,
    memberUserIds: string[],
    now: Date,
  ): Promise<void> {
    if (memberUserIds.length === 0) return
    // Batch insert; ids are validated + deduped by the input validator.
    const params: unknown[] = []
    const values = memberUserIds
      .map((userId) => {
        const base = params.length
        params.push(uuidv7(), teamId, userId, now, now)
        return `($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}, $${base + 5})`
      })
      .join(', ')
    await client.query(
      `INSERT INTO staff_team_members (id, team_id, user_id, created_at, updated_at) VALUES ${values}`,
      params,
    )
  }

  private async recordTeamAudit(
    client: { query: (sql: string, params?: unknown[]) => Promise<unknown> },
    event: string,
    actorUserId: string,
    ip: string,
    now: Date,
    metadata: Record<string, unknown>,
  ): Promise<void> {
    const auditId = uuidv7()
    const correlationId = uuidv7()
    await client.query(
      `INSERT INTO audit_log (id, user_id, event, metadata, correlation_id, ip, created_at)
       VALUES ($1, $2, $3, $4::jsonb, $5, $6, $7)`,
      [auditId, actorUserId, event, JSON.stringify(metadata), correlationId, ip, now],
    )
  }

  private isUniqueViolation(error: unknown, constraint: string): boolean {
    const e = error as { code?: string; constraint?: string } | null
    return e?.code === '23505' && e?.constraint === constraint
  }

  private mapTeamRow(
    row: { id: string; name: string; description: string | null; skill_tags: unknown; is_active: boolean; created_at: Date; updated_at: Date },
    memberUserIds: string[],
  ): StaffTeamRecord {
    return {
      id: row.id,
      name: row.name,
      description: row.description,
      skillTags: Array.isArray(row.skill_tags) ? (row.skill_tags as string[]) : [],
      isActive: row.is_active,
      memberUserIds,
      createdAt: row.created_at.toISOString(),
      updatedAt: row.updated_at.toISOString(),
    }
  }

  // ── Staff user list & disable (T-10.01.01) ───────────────────────────

  /**
   * List staff accounts for the admin staff management view.
   *
   * "Staff" = users who are platform admins (`is_admin`) OR hold at least
   * one staff role (`user_roles`), i.e. the accounts an admin manages —
   * deliberately separate from the CRM customer list. Each row carries the
   * default-profile name, aggregated role names, last successful login
   * (`last_login_at`), and account status derived from `disabled_at`.
   *
   * @param query - Pagination (limit clamped to 1..200, default 50).
   */
  async listStaff(query: StaffListQuery = {}): Promise<StaffListResult> {
    const pool = getDbPool()
    const limit = Math.min(Math.max(Math.trunc(query.limit ?? 50), 1), 200)
    const offset = Math.max(Math.trunc(query.offset ?? 0), 0)

    const staffWhere = `u.is_admin = true OR EXISTS (SELECT 1 FROM user_roles x WHERE x.user_id = u.user_id)`

    const countResult = await pool.query<{ total: number }>(
      `SELECT COUNT(*)::int AS total
       FROM users u
       WHERE ${staffWhere}`,
    )
    const total = countResult.rows[0]?.total ?? 0

    const listResult = await pool.query<{
      user_id: string
      username: string
      email: string | null
      mobile: string | null
      is_admin: boolean
      created_at: Date
      last_login_at: Date | null
      disabled_at: Date | null
      first_name: string | null
      last_name: string | null
      roles: unknown
    }>(
      `SELECT u.user_id, u.username, u.email, u.mobile, u.is_admin,
              u.created_at, u.last_login_at, u.disabled_at,
              p.first_name, p.last_name,
              COALESCE(
                json_agg(json_build_object('roleId', r.role_id, 'name', r.name) ORDER BY r.name)
                  FILTER (WHERE r.role_id IS NOT NULL),
                '[]'
              ) AS roles
       FROM users u
       LEFT JOIN profiles p
         ON p.user_id = u.user_id
        AND p.is_default = true
       LEFT JOIN user_roles ur ON ur.user_id = u.user_id
       LEFT JOIN staff_roles r ON r.role_id = ur.role_id
       WHERE ${staffWhere}
       GROUP BY u.user_id, u.username, u.email, u.mobile, u.is_admin,
                u.created_at, u.last_login_at, u.disabled_at,
                p.first_name, p.last_name
       ORDER BY u.created_at DESC
       LIMIT $1 OFFSET $2`,
      [limit, offset],
    )

    const items: StaffUserSummary[] = listResult.rows.map((row) => ({
      userId: row.user_id,
      username: row.username,
      email: row.email,
      mobile: row.mobile,
      firstName: row.first_name,
      lastName: row.last_name,
      roles: Array.isArray(row.roles)
        ? (row.roles as { roleId: string; name: string }[])
        : [],
      isAdmin: row.is_admin,
      lastLoginAt: row.last_login_at ? row.last_login_at.toISOString() : null,
      disabledAt: row.disabled_at ? row.disabled_at.toISOString() : null,
      status: row.disabled_at ? 'disabled' : 'active',
      createdAt: row.created_at.toISOString(),
    }))

    return { items, total, limit, offset }
  }

  /**
   * Disable a staff account (T-10.01.01).
   *
   * Atomically: marks the account disabled (`disabled_at`), revokes every
   * active session, consumes every active refresh token, and records an
   * `audit_log` entry. Login, password reset, and refresh-token redemption
   * all reject disabled accounts afterwards, so a disabled staff member is
   * signed out everywhere immediately and cannot authenticate again.
   *
   * Idempotent: disabling an already-disabled account succeeds with
   * `alreadyDisabled: true` and issues no additional writes.
   *
   * @throws 404 when the user is not a staff account (or does not exist)
   * @throws 400 when an admin attempts to disable their own account
   */
  async disableStaff(input: DisableStaffInput): Promise<DisableStaffResult> {
    const pool = getDbPool()
    const client = await pool.connect()
    const now = new Date()

    try {
      await client.query('BEGIN')

      // Lock the target row; staff-only so the endpoint cannot probe
      // arbitrary customer accounts.
      const targetResult = await client.query<{
        user_id: string
        username: string
        disabled_at: Date | null
      }>(
        `SELECT u.user_id, u.username, u.disabled_at
         FROM users u
         WHERE u.user_id = $1
           AND (u.is_admin = true OR EXISTS (SELECT 1 FROM user_roles x WHERE x.user_id = u.user_id))
         FOR UPDATE`,
        [input.userId],
      )

      if (targetResult.rows.length === 0) {
        await client.query('ROLLBACK')
        throw new HttpException(
          { statusCode: 404, error: ErrorCodes.NOT_FOUND_RESOURCE.code },
          404,
        )
      }

      const target = targetResult.rows[0]!

      if (input.userId === input.actorUserId) {
        await client.query('ROLLBACK')
        throw new HttpException(
          {
            statusCode: 400,
            error: 'STAFF_DISABLE_SELF',
            message: 'An admin cannot disable their own account',
          },
          400,
        )
      }

      if (target.disabled_at) {
        await client.query('COMMIT')
        this.logger.log(
          `Staff user ${target.user_id} already disabled (idempotent no-op) by ${input.actorUserId}`,
        )
        return {
          userId: target.user_id,
          username: target.username,
          status: 'disabled',
          disabledAt: target.disabled_at.toISOString(),
          alreadyDisabled: true,
        }
      }

      // Mark disabled + revoke sessions + consume refresh tokens in ONE
      // transaction so no active credential survives the disable.
      await client.query(
        `UPDATE users
         SET disabled_at = $1, updated_at = $1
         WHERE user_id = $2`,
        [now, target.user_id],
      )

      await client.query(
        `UPDATE sessions
         SET revoked_at = $1, updated_at = $1
         WHERE user_id = $2 AND revoked_at IS NULL`,
        [now, target.user_id],
      )

      await client.query(
        `UPDATE refresh_tokens
         SET consumed_at = $1
         WHERE user_id = $2 AND consumed_at IS NULL`,
        [now, target.user_id],
      )

      // Audit trail: who disabled whom, when, and the correlation id.
      const auditId = uuidv7()
      const correlationId = uuidv7()
      await client.query(
        `INSERT INTO audit_log (id, user_id, event, metadata, correlation_id, ip, created_at)
         VALUES ($1, $2, $3, $4::jsonb, $5, $6, $7)`,
        [
          auditId,
          target.user_id,
          'staff_user_disabled',
          JSON.stringify({
            actorUserId: input.actorUserId,
            disabledAt: now.toISOString(),
            correlationId,
          }),
          correlationId,
          input.ip,
          now,
        ],
      )

      await client.query('COMMIT')

      this.logger.log(
        `Staff user ${target.user_id} (${target.username}) disabled by ${input.actorUserId}; ${'all sessions revoked'}`,
      )

      return {
        userId: target.user_id,
        username: target.username,
        status: 'disabled',
        disabledAt: now.toISOString(),
        alreadyDisabled: false,
      }
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {})
      if (err instanceof HttpException) throw err
      this.logger.error(`Failed to disable staff user ${input.userId}: ${String(err)}`)
      throw new HttpException(
        { statusCode: 500, error: ErrorCodes.INTERNAL_SERVER.code },
        500,
      )
    } finally {
      client.release()
    }
  }

  /**
   * Staff permission audit timeline (T-10.01.02).
   *
   * Returns `role_change` audit events — the record of role additions and
   * removals for staff users — newest first, paginated, and filterable by
   * target user and date range. Each event is enriched with the target and
   * actor usernames, and the role names resolved from `staff_roles`, with
   * `addedRoles`/`removedRoles` computed as the diff between the previous
   * and the new role set.
   *
   * The `role_change` event is written by `updateStaffRoles` with the
   * actor in `audit_log.user_id` and the affected user in
   * `metadata.targetUserId`. Because a role change is a permission change
   * (roles grant permissions, deny-by-default), this timeline is the staff
   * permission audit trail.
   *
   * @throws 400 when `userId` is not a UUID or the date range is invalid
   */
  async listStaffAudit(query: StaffAuditQuery = {}): Promise<StaffAuditResult> {
    const pool = getDbPool()
    const limit = Math.min(Math.max(Math.trunc(query.limit ?? 50), 1), 200)
    const offset = Math.max(Math.trunc(query.offset ?? 0), 0)

    // ── Validate filters ───────────────────────────────────────────
    if (query.userId !== undefined && !UUID_RE.test(query.userId)) {
      throw new HttpException(
        { statusCode: 400, error: ErrorCodes.VALIDATION_INPUT_INVALID.code, message: 'userId must be a valid UUID' },
        400,
      )
    }

    const from = query.from !== undefined ? new Date(query.from) : null
    const to = query.to !== undefined ? new Date(query.to) : null
    if (query.from !== undefined && Number.isNaN(from!.getTime())) {
      throw new HttpException(
        { statusCode: 400, error: ErrorCodes.VALIDATION_INPUT_INVALID.code, message: 'from must be a valid ISO timestamp' },
        400,
      )
    }
    if (query.to !== undefined && Number.isNaN(to!.getTime())) {
      throw new HttpException(
        { statusCode: 400, error: ErrorCodes.VALIDATION_INPUT_INVALID.code, message: 'to must be a valid ISO timestamp' },
        400,
      )
    }
    if (from && to && from.getTime() > to.getTime()) {
      throw new HttpException(
        { statusCode: 400, error: ErrorCodes.VALIDATION_INPUT_INVALID.code, message: 'from must not be after to' },
        400,
      )
    }

    // ── Count ──────────────────────────────────────────────────────
    const countResult = await pool.query<{ total: number }>(
      `SELECT COUNT(*)::int AS total
       FROM audit_log a
       WHERE a.event = 'role_change'
         AND ($1::text IS NULL OR a.metadata::jsonb->>'targetUserId' = $1)
         AND ($2::timestamptz IS NULL OR a.created_at >= $2)
         AND ($3::timestamptz IS NULL OR a.created_at <= $3)`,
      [query.userId ?? null, from, to],
    )
    const total = countResult.rows[0]?.total ?? 0

    if (total === 0) {
      return { items: [], total, limit, offset }
    }

    // ── Role names for diff rendering ──────────────────────────────
    const rolesResult = await pool.query<{ role_id: string; name: string }>(
      `SELECT role_id, name FROM staff_roles`,
    )
    const roleNames = new Map(rolesResult.rows.map((r) => [r.role_id, r.name]))

    // ── Page ───────────────────────────────────────────────────────
    const listResult = await pool.query<{
      id: string
      actor_user_id: string
      target_user_id: string | null
      target_username: string | null
      actor_username: string | null
      metadata: unknown
      correlation_id: string | null
      ip: string | null
      created_at: Date
    }>(
      `SELECT a.id,
              a.user_id AS actor_user_id,
              a.metadata::jsonb->>'targetUserId' AS target_user_id,
              tu.username AS target_username,
              au.username AS actor_username,
              a.metadata,
              a.correlation_id,
              a.ip,
              a.created_at
       FROM audit_log a
       LEFT JOIN users tu ON tu.user_id = a.metadata::jsonb->>'targetUserId'
       LEFT JOIN users au ON au.user_id = a.user_id
       WHERE a.event = 'role_change'
         AND ($1::text IS NULL OR a.metadata::jsonb->>'targetUserId' = $1)
         AND ($2::timestamptz IS NULL OR a.created_at >= $2)
         AND ($3::timestamptz IS NULL OR a.created_at <= $3)
       ORDER BY a.created_at DESC, a.id DESC
       LIMIT $4 OFFSET $5`,
      [query.userId ?? null, from, to, limit, offset],
    )

    const items: StaffAuditEvent[] = listResult.rows.map((row) => {
      const meta = parseRoleChangeMetadata(row.metadata)
      const previousRoleIds = Array.isArray(meta?.previousRoleIds) ? meta!.previousRoleIds : []
      const newRoleIds = Array.isArray(meta?.newRoleIds) ? meta!.newRoleIds : []
      const addedRoleIds = newRoleIds.filter((id) => !previousRoleIds.includes(id))
      const removedRoleIds = previousRoleIds.filter((id) => !newRoleIds.includes(id))
      const withNames = (ids: string[]): StaffAuditRoleChange[] =>
        ids.map((roleId) => ({ roleId, roleName: roleNames.get(roleId) ?? roleId }))

      return {
        id: row.id,
        targetUserId: row.target_user_id ?? meta?.targetUserId ?? '',
        targetUsername: row.target_username,
        actorUserId: row.actor_user_id,
        actorUsername: row.actor_username,
        addedRoles: withNames(addedRoleIds),
        removedRoles: withNames(removedRoleIds),
        previousRoleIds,
        newRoleIds,
        reason: (meta?.reason as string | undefined) ?? null,
        correlationId: row.correlation_id,
        ip: row.ip,
        createdAt: row.created_at.toISOString(),
      }
    })

    return { items, total, limit, offset }
  }
}
