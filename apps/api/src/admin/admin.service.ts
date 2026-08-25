import { Injectable, Logger, HttpException } from '@nestjs/common'
import { v7 as uuidv7 } from 'uuid'
import * as argon2 from 'argon2'
import { getDbPool } from '@barghsa/db'

/**
 * Supported activation methods for new staff users.
 * - `tempPassword`: generate a temporary password, force change on first login.
 * - `link`: generate a time-limited activation link (24h).
 */
export type ActivationMethod = 'tempPassword' | 'link'

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

  if (!upperRe.test(result)) {
    const pos = Math.floor(Math.random() * length)
    const upperChars = 'ABCDEFGHJKLMNPQRSTUVWXYZ'
    const replacement = upperChars[Math.floor(Math.random() * upperChars.length)]
    result = result.slice(0, pos) + replacement + result.slice(pos + 1)
  }

  if (!lowerRe.test(result)) {
    const pos = Math.floor(Math.random() * length)
    const lowerChars = 'abcdefghjkmnpqrstuvwxyz'
    const replacement = lowerChars[Math.floor(Math.random() * lowerChars.length)]
    result = result.slice(0, pos) + replacement + result.slice(pos + 1)
  }

  if (!digitRe.test(result)) {
    const pos = Math.floor(Math.random() * length)
    const digits = '23456789'
    const replacement = digits[Math.floor(Math.random() * digits.length)]
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
}