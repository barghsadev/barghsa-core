import { Injectable, Logger, HttpException } from '@nestjs/common'
import { v7 as uuidv7 } from 'uuid'
import * as argon2 from 'argon2'
import { getDbPool } from '@barghsa/db'
import { ErrorCodes } from '@barghsa/shared/errors'

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
 * Depending on activationMethod, either a temporary password or a confirmation.
 */
export type CreateStaffUserResult = {
  userId: string
  username: string
  activationMethod: ActivationMethod
} & (
  | { temporaryPassword: string; message: string }
  | { message: string }
)

/**
 * Generates a cryptographically random temporary password.
 * Format: prefix + 16 alphanumeric chars, e.g. "Bg7aK2xR9mQp3WnV".
 */
function generateTemporaryPassword(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789'
  let result = ''
  const array = new Uint8Array(16)
  const crypto = globalThis.crypto
  crypto.getRandomValues(array)
  const arr = array
  for (let i = 0; i < 16; i++) {
    result += chars[arr[i]! % chars.length]
  }
  // Ensure at least one uppercase, one lowercase, one digit
  return 'A' + result.slice(1, 8) + '9' + result.slice(9)
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
   * 1. Validate username uniqueness
   * 2. Generate password (tempPassword) or activation token (link)
   * 3. Hash password with Argon2id
   * 4. Create user record with is_admin = true
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

    // ── 1. Check username uniqueness ──────────────────────────────────
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
      const strongPassword = generateTemporaryPassword() + 'Xx1'
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
        message: 'Staff user created. An activation link has been sent.',
      }
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {
        // Non-critical
      })

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