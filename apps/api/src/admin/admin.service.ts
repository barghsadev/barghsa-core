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
}
