import { Injectable, Logger, HttpException } from '@nestjs/common'
import { v7 as uuidv7 } from 'uuid'
import * as argon2 from 'argon2'
import { getDbPool, PREDEFINED_ROLES } from '@barghsa/db'

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
      let permissions: string[] = []
      try {
        const parsed = JSON.parse(row.permissions ?? '[]')
        if (Array.isArray(parsed)) permissions = parsed.filter((p) => typeof p === 'string')
      } catch {
        permissions = []
      }

      return {
        roleId: row.role_id,
        name: row.name,
        description: row.description,
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
      let permissions: string[] = []
      try {
        const parsed = JSON.parse(row.permissions ?? '[]')
        if (Array.isArray(parsed)) permissions = parsed.filter((p) => typeof p === 'string')
      } catch {
        permissions = []
      }
      for (const p of permissions) permissionSet.add(p)
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
}