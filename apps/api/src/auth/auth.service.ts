import { HttpException, Injectable, Logger } from '@nestjs/common'
import { randomBytes } from 'node:crypto'
import { v7 as uuidv7 } from 'uuid'
import * as argon2 from 'argon2'
import { getDbPool } from '@barghsa/db'
import { ErrorCodes } from '@barghsa/shared/errors'
import type { RegisterInput, RegisterResponse } from './dto/register.dto.js'
import type { RegisterVerifyResponse } from './dto/otp.dto.js'
import { OtpService } from './otp.service.js'

/** Session idle timeout: 30 minutes */
const SESSION_IDLE_TIMEOUT_MS = 30 * 60 * 1000
/** Session absolute timeout: 24 hours */
const SESSION_ABSOLUTE_TIMEOUT_MS = 24 * 60 * 60 * 1000

/**
 * Service handling registration business logic.
 *
 * At this stage (T-01.02.01 / T-01.02.03), the service validates the input,
 * checks for duplicate usernames (stub), creates an OTP challenge via
 * OtpService (storing password hash for atomic consumption on verify),
 * and on OTP verify creates the user record and session atomically.
 */
@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name)

  constructor(private readonly otpService: OtpService) {}

  /**
   * Attempt to register a new user.
   *
   * Validates input, checks username availability, creates an OTP challenge
   * that also stores the password hash and TOS version for atomic consumption
   * on OTP verify. Returns a `challengeId` for the next step (OTP verification).
   */
  async register(
    input: RegisterInput,
    ip: string,
  ): Promise<RegisterResponse> {
    // ── Check username availability (stub until DB wiring) ──────────
    // TODO: Replace with real DB query when user table is created
    const usernameTaken = false
    if (usernameTaken) {
      throw new HttpException(
        {
          statusCode: ErrorCodes.AUTH_REGISTER_USERNAME_TAKEN.httpStatus,
          error: ErrorCodes.AUTH_REGISTER_USERNAME_TAKEN.code,
        },
        ErrorCodes.AUTH_REGISTER_USERNAME_TAKEN.httpStatus,
      )
    }

    // ── Validate TOS version (stub until E-04 TOS admin is implemented) ──
    const validTosVersions = new Set(['current'])
    if (!validTosVersions.has(input.tosVersionId)) {
      throw new HttpException(
        {
          statusCode: ErrorCodes.AUTH_REGISTER_TOS_NOT_ACCEPTED.httpStatus,
          error: ErrorCodes.AUTH_REGISTER_TOS_NOT_ACCEPTED.code,
        },
        ErrorCodes.AUTH_REGISTER_TOS_NOT_ACCEPTED.httpStatus,
      )
    }

    // ── Create OTP challenge (storing password hash and TOS version) ──
    const passwordHash = await argon2.hash(input.password)
    const { challengeId } = await this.otpService.createChallenge(
      input.username,
      ip,
      passwordHash,
      input.tosVersionId,
    )

    return { challengeId }
  }

  /**
   * Complete registration after OTP verification.
   *
   * Atomically: verifies the OTP → creates user record → creates session.
   * Returns session token and CSRF token for the frontend.
   */
  async completeRegistration(
    challengeId: string,
    otp: string,
    ip: string,
  ): Promise<RegisterVerifyResponse> {
    const pool = getDbPool()
    const client = await pool.connect()

    try {
      await client.query('BEGIN')

      // 1. Lock and fetch the challenge row
      const challengeResult = await client.query(
        `SELECT challenge_id, destination, otp_hash, attempts_remaining,
                expires_at, consumed_at, password_hash, tos_version_id
         FROM otp_challenges
         WHERE challenge_id = $1
         FOR UPDATE`,
        [challengeId],
      )

      if (challengeResult.rows.length === 0) {
        throw new HttpException(
          { statusCode: 404, error: ErrorCodes.NOT_FOUND_RESOURCE.code },
          404,
        )
      }

      const row = challengeResult.rows[0]

      // Check consumed
      if (row.consumed_at) {
        throw new HttpException(
          { statusCode: 409, error: ErrorCodes.AUTH_OTP_CONSUMED.code },
          409,
        )
      }

      // Check expiry
      if (new Date(row.expires_at) < new Date()) {
        throw new HttpException(
          { statusCode: 401, error: ErrorCodes.AUTH_OTP_EXPIRED.code },
          401,
        )
      }

      // Check attempts
      if (row.attempts_remaining <= 0) {
        throw new HttpException(
          { statusCode: 401, error: ErrorCodes.AUTH_OTP_MAX_ATTEMPTS.code },
          401,
        )
      }

      // Check password_hash was stored (should always be present for registration)
      if (!row.password_hash || !row.tos_version_id) {
        this.logger.error(`Missing registration data for challenge ${challengeId}`)
        throw new HttpException(
          {
            statusCode: ErrorCodes.AUTH_REGISTER_FAILED.httpStatus,
            error: ErrorCodes.AUTH_REGISTER_FAILED.code,
          },
          ErrorCodes.AUTH_REGISTER_FAILED.httpStatus,
        )
      }

      // 2. Verify OTP inside the transaction
      const submittedHash = this.otpService.hashOtp(otp)
      if (!this.otpService.compareOtpHashes(submittedHash, row.otp_hash)) {
        // Decrement attempts inside the transaction and commit
        await client.query(
          `UPDATE otp_challenges
           SET attempts_remaining = attempts_remaining - 1, updated_at = NOW()
           WHERE challenge_id = $1 AND attempts_remaining > 0`,
          [challengeId],
        )
        await client.query('COMMIT')

        throw new HttpException(
          { statusCode: 401, error: ErrorCodes.AUTH_OTP_INVALID.code },
          401,
        )
      }

      // 3. Create user + consume OTP + create session atomically
      const userId = uuidv7()
      const sessionId = uuidv7()
      const csrfToken = randomBytes(32).toString('hex')
      const now = new Date()
      const expiresAt = new Date(now.getTime() + SESSION_ABSOLUTE_TIMEOUT_MS)
      const idleDeadline = new Date(now.getTime() + SESSION_IDLE_TIMEOUT_MS)

      // Consume the OTP challenge
      const consumeResult = await client.query(
        `UPDATE otp_challenges
         SET consumed_at = $1, attempts_remaining = 0, updated_at = $1
         WHERE challenge_id = $2 AND consumed_at IS NULL`,
        [now, challengeId],
      )

      if (consumeResult.rowCount === 0) {
        throw new HttpException(
          { statusCode: 409, error: ErrorCodes.AUTH_OTP_CONSUMED.code },
          409,
        )
      }

      // Create user record
      await client.query(
        `INSERT INTO users (user_id, username, password_hash, locale,
                            last_accepted_tos_version, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $6)`,
        [
          userId,
          row.destination,
          row.password_hash,
          'fa',
          row.tos_version_id,
          now,
        ],
      )

      // Create session
      await client.query(
        `INSERT INTO sessions (session_id, user_id, csrf_token,
                               expires_at, idle_deadline, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $6)`,
        [sessionId, userId, csrfToken, expiresAt, idleDeadline, now],
      )

      await client.query('COMMIT')

      this.logger.log(`User created: ${userId} (${row.destination}) from ${ip}`)

      return {
        userId,
        sessionId,
        csrfToken,
        expiresAt: expiresAt.toISOString(),
      }
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {})

      // Re-throw HttpExceptions as-is
      if (err instanceof HttpException) throw err

      this.logger.error(`Failed to create user for challenge ${challengeId}: ${String(err)}`)
      throw new HttpException(
        {
          statusCode: ErrorCodes.AUTH_REGISTER_FAILED.httpStatus,
          error: ErrorCodes.AUTH_REGISTER_FAILED.code,
        },
        ErrorCodes.AUTH_REGISTER_FAILED.httpStatus,
      )
    } finally {
      client.release()
    }
  }
}