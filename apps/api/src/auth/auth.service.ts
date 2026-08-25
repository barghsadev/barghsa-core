import { HttpException, Injectable, Logger } from '@nestjs/common'
import { createHash } from 'node:crypto'
import { v7 as uuidv7 } from 'uuid'
import * as argon2 from 'argon2'
import { getDbPool } from '@barghsa/db'
import { ErrorCodes } from '@barghsa/shared/errors'
import { rateLimitKey } from '@barghsa/shared/rate-limit'
import type { RegisterInput, RegisterResponse } from './dto/register.dto.js'
import type { RegisterVerifyResponse } from './dto/otp.dto.js'
import type { LoginInput, LoginResponse, LoginVerifyResponse } from './dto/login.dto.js'
import type { ForceChangePasswordInput, ForceChangePasswordResponse } from './dto/force-change-password.dto.js'
import type { ForgotPasswordInput, ForgotPasswordResponse } from './dto/forgot-password.dto.js'
import type { ResetPasswordInput, ResetPasswordResponse } from './dto/reset-password.dto.js'
import { OtpService } from './otp.service.js'
import { SessionService } from '../session/session.service.js'
import { RateLimitService } from '../rate-limit/rate-limit.service.js'

/**
 * Service handling registration and login business logic.
 *
 * Creates user records, verifies credentials with Argon2id,
 * and delegates session creation to SessionService (T-02.02.01).
 */
@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name)

  /**
   * Pre-computed Argon2id hash of a dummy string, used to equalize response
   * timing when the username is not found — prevents user enumeration via
   * timing side-channel (T-02.01.02 hardening).
   * Lazy-initialized so module load doesn't block on hashing.
   */
  private static _dummyHash: string | null = null
  private static _dummyHashPromise: Promise<void> | null = null

  constructor(
    private readonly otpService: OtpService,
    private readonly sessionService: SessionService,
    private readonly rateLimitService: RateLimitService,
  ) {}

  /**
   * Kick off the dummy hash computation so it's ready by the time a login
   * request arrives. Caches the result in _dummyHash.
   * Errors (e.g. argon2 mock in test) are silently caught — without the
   * dummy hash, the timing side-channel guard simply degrades gracefully.
   */
  private async ensureDummyHash(): Promise<void> {
    if (AuthService._dummyHash) return
    if (!AuthService._dummyHashPromise) {
      AuthService._dummyHashPromise = argon2
        .hash('__barghsa_timing_constant__')
        .then((hash) => {
          AuthService._dummyHash = hash
        })
        .catch(() => {
          // argon2 mock or unavailability — timing guard degrades gracefully
          AuthService._dummyHashPromise = null
        })
    }
    return AuthService._dummyHashPromise
  }

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
   * Authenticate a user with username + password credentials.
   *
   * Uses Argon2id for password verification (mem=37MiB, t=3, p=1).
   *
   * Steps:
   * 1. Look up user by normalized username
   * 2. Verify password hash with Argon2id
   * 3. Check whether risk-based OTP enforcement is needed (stub: always false for now)
   * 4. If no OTP needed → create session atomically
   * 5. If OTP needed → create OTP challenge (future: T-02.01.03)
   *
   * Error is always a generic "invalid credentials" — never distinguishes
   * between "user not found" and "wrong password" to prevent enumeration.
   */
  async login(input: LoginInput, ip: string): Promise<LoginResponse> {
    const pool = getDbPool()

    // Kick off dummy hash computation if not yet ready (settles in ~200ms;
    // by the time the client types a password on the next request it's ready)
    this.ensureDummyHash()

    // ── Progressive delay: slow down repeated failed attempts ─────────
    // Before checking credentials, peek at the current rate-limit counter
    // for this IP in the 15-minute login window.  The guard has already
    // incremented the counter for the current request, so subtract 1 to
    // get the number of *prior* failed attempts.  If there have been prior
    // failures, apply an exponential back-off delay to frustrate automated
    // brute-force scripts while keeping the UX tolerable for legitimate
    // users who mistype their password a few times.
    const rateLimitKeyStr = rateLimitKey('login:account-ip', ip)
    const currentCount = await this.rateLimitService.getSecurityCount(rateLimitKeyStr, 900_000)
    const priorAttempts = Math.max(0, currentCount - 1)
    if (priorAttempts >= 1) {
      // Progressive delay: 2^(priorAttempts - 1) * 500ms, capped at 5_000ms
      // attempt 1: 500ms, 2: 1000ms, 3: 2000ms, 4: 4000ms, 5+: 5000ms
      const delayMs = Math.min(Math.pow(2, priorAttempts - 1) * 500, 5_000)
      this.logger.debug(
        `Progressive delay for login: ${rateLimitKeyStr} (${priorAttempts} prior attempts, ${delayMs}ms)`,
      )
      await new Promise((resolve) => setTimeout(resolve, delayMs))
    }

    try {
      // 1. Look up user by normalized username
      const userResult = await pool.query(
        `SELECT user_id, password_hash, must_change_password,
                password_change_token, password_change_token_expires_at, is_admin
         FROM users
         WHERE username = $1`,
        [input.username],
      )

      const userFound = userResult.rows.length > 0
      const dummyHash = AuthService._dummyHash

      // 2. Verify password with Argon2id (falling through to dummy hash
      //    when user not found, to equalize response timing)
      let passwordValid = false

      if (userFound) {
        try {
          passwordValid = await argon2.verify(
            userResult.rows[0].password_hash,
            input.password,
          )
        } catch {
          // Corrupted or malformed password_hash — treat as invalid credential
          // without revealing internal hash format details
        }
      } else if (dummyHash) {
        try {
          await argon2.verify(dummyHash, input.password)
        } catch {
          // Dummy hash not ready yet — timing inequality is acceptable on
          // first few requests; the hash settles within ~200ms of app start
        }
      }

      if (!userFound || !passwordValid) {
        throw new HttpException(
          { statusCode: 401, error: ErrorCodes.AUTH_LOGIN_INVALID_CREDENTIALS.code },
          401,
        )
      }

      // 3b. Extract user properties
      const userId = userResult.rows[0].user_id
      const isStaff = userResult.rows[0].is_admin ?? false

      // 3c. Check if user must change password (T-02.01.04)
      // NOTE: This check intentionally precedes MFA/OTP enforcement (step 4).
      // No session is established for the must-change-password flow, so the
      // user must re-authenticate (with MFA if required) after the password
      // change. MFA is therefore deferred rather than skipped.
      const mustChangePassword = userResult.rows[0].must_change_password ?? false

      if (mustChangePassword) {
        // Generate a short-lived token to authorize the password change
        const passwordChangeToken = uuidv7()
        const tokenExpiry = new Date(Date.now() + 5 * 60 * 1000) // 5 minutes

        await pool.query(
          `UPDATE users
           SET password_change_token = $1, password_change_token_expires_at = $2, updated_at = NOW()
           WHERE user_id = $3`,
          [passwordChangeToken, tokenExpiry, userId],
        )

        this.logger.log(`Password change required for user ${userId} from ${ip}`)

        return {
          requiresOtp: false,
          mustChangePassword: true,
          passwordChangeToken,
        }
      }

      // 4. Check if risk-based OTP enforcement is needed (T-02.01.03)
      const deviceFingerprint = input.deviceInfo?.fingerprint
        ? createHash('sha256').update(input.deviceInfo.fingerprint).digest('hex')
        : null

      let requiresOtp = false

      // Check device trust for all users
      if (deviceFingerprint) {
        const trustResult = await pool.query(
          `SELECT 1 FROM device_trusts
           WHERE user_id = $1 AND device_fingerprint = $2
             AND expires_at > NOW()
           LIMIT 1`,
          [userId, deviceFingerprint],
        )

        if (trustResult.rows.length > 0) {
          // Trusted device found — skip OTP for customers
          requiresOtp = false
        } else if (isStaff) {
          // Staff on an untrusted device: mandatory MFA
          requiresOtp = true
        } else {
          // Customer on an untrusted device: risk-based MFA
          requiresOtp = true
        }
      } else {
        // No device info provided — always require OTP (conservative)
        requiresOtp = true
      }

      if (requiresOtp) {
        const { challengeId } = await this.otpService.createLoginChallenge(
          userId,
          input.username,
          ip,
        )

        this.logger.log(`OTP challenge created for login: user ${userId} from ${ip}`)

        return {
          requiresOtp: true,
          challengeId,
          userIsStaff: isStaff,
        }
      }

      // 4. Create session via SessionService
      const session = await this.sessionService.createSession(
        userId,
        isStaff,
        { ip, ...(input.deviceInfo?.userAgent ? { userAgent: input.deviceInfo.userAgent } : {}), ...(input.deviceInfo?.fingerprint ? { fingerprint: input.deviceInfo.fingerprint } : {}) },
      )

      // Reset rate-limit counters on successful login
      await this.rateLimitService.resetSecurityRateLimit(rateLimitKeyStr).catch(() => {
        // Non-critical — counter will expire naturally
      })

      this.logger.log(`User logged in: ${userId} (${input.username}) from ${ip}`)

      return {
        requiresOtp: false,
        userId,
        sessionId: session.sessionId,
        csrfToken: session.csrfToken,
        refreshToken: session.refreshToken,
        expiresAt: session.expiresAt.toISOString(),
      }
    } catch (err) {
      // Re-throw HttpExceptions as-is (safe structured errors)
      if (err instanceof HttpException) throw err

      this.logger.error(`Login failed for user ${input.username}: ${String(err)}`)
      throw new HttpException(
        { statusCode: 500, error: ErrorCodes.AUTH_LOGIN_FAILED.code },
        500,
      )
    }
  }

  /**
   * Force a password change after login detection (T-02.01.04).
   *
   * Validates the one-time password change token issued during login,
   * checks password history to prevent reuse of the last N passwords (default 5),
   * and atomically: updates the password hash, clears the change token/flags,
   * and records the old password in history.
   *
   * No session is established — the user must log in again after the change.
   */
  async forceChangePassword(
    input: ForceChangePasswordInput,
    ip: string,
  ): Promise<ForceChangePasswordResponse> {
    const pool = getDbPool()
    const client = await pool.connect()

    try {
      await client.query('BEGIN')

      // 1. Look up the user by password change token
      const userResult = await client.query(
        `SELECT user_id, password_hash, must_change_password,
                password_change_token, password_change_token_expires_at
         FROM users
         WHERE password_change_token = $1
         FOR UPDATE`,
        [input.passwordChangeToken],
      )

      if (userResult.rows.length === 0) {
        throw new HttpException(
          { statusCode: 400, error: ErrorCodes.AUTH_LOGIN_MUST_CHANGE_PASSWORD.code },
          400,
        )
      }

      const user = userResult.rows[0]

      // 2. Verify the token hasn't expired
      if (!user.must_change_password) {
        throw new HttpException(
          { statusCode: 400, error: ErrorCodes.AUTH_LOGIN_MUST_CHANGE_PASSWORD.code },
          400,
        )
      }

      if (user.password_change_token_expires_at && new Date(user.password_change_token_expires_at) < new Date()) {
        throw new HttpException(
          { statusCode: 400, error: ErrorCodes.AUTH_LOGIN_MUST_CHANGE_PASSWORD.code },
          400,
        )
      }

      // 3. Check password history (last 5 passwords)
      const historyResult = await client.query(
        `SELECT password_hash FROM password_history
         WHERE user_id = $1
         ORDER BY version DESC
         LIMIT 5`,
        [user.user_id],
      )

      const newHash = await argon2.hash(input.newPassword)

      // 3a. Check against the current password (must differ from current)
      const isSameAsCurrent = await argon2.verify(user.password_hash, input.newPassword).catch(() => false)
      if (isSameAsCurrent) {
        await client.query('ROLLBACK')
        this.logger.warn(`Password reuse (same as current) detected for user ${user.user_id} from ${ip}`)
        throw new HttpException(
          { statusCode: 422, error: ErrorCodes.AUTH_LOGIN_PASSWORD_REUSED.code },
          422,
        )
      }

      // 3b. Check password history (last 5 passwords)
      for (const entry of historyResult.rows) {
        const isReused = await argon2.verify(entry.password_hash, input.newPassword).catch(() => false)
        if (isReused) {
          await client.query('ROLLBACK')
          this.logger.warn(`Password reuse detected for user ${user.user_id} from ${ip}`)
          throw new HttpException(
            { statusCode: 422, error: ErrorCodes.AUTH_LOGIN_PASSWORD_REUSED.code },
            422,
          )
        }
      }

      // 4. Record current password in history, then update user
      const version = historyResult.rows.length > 0
        ? historyResult.rows[0].version + 1
        : 1

      const historyId = uuidv7()
      const now = new Date()

      // Insert old password into history
      await client.query(
        `INSERT INTO password_history (id, user_id, password_hash, version, created_at)
         VALUES ($1, $2, $3, $4, $5)`,
        [historyId, user.user_id, user.password_hash, version, now],
      )

      // Update user: new password hash, clear change flag and token
      await client.query(
        `UPDATE users
         SET password_hash = $1,
             must_change_password = false,
             password_change_token = NULL,
             password_change_token_expires_at = NULL,
             updated_at = $2
         WHERE user_id = $3`,
        [newHash, now, user.user_id],
      )

      await client.query('COMMIT')

      this.logger.log(`Password changed for user ${user.user_id} from ${ip}`)

      return {
        message: 'Password changed successfully. Please log in with your new password.',
      }
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {})

      if (err instanceof HttpException) throw err

      this.logger.error(`Force password change failed: ${String(err)}`)
      throw new HttpException(
        { statusCode: 500, error: ErrorCodes.INTERNAL_SERVER.code },
        500,
      )
    } finally {
      client.release()
    }
  }

  /**
   * Initiate a forgot-password flow (T-02.03.01).
   *
   * Accepts a normalized username (email or E.164 phone). Looks up the user
   * and, if found, creates an OTP challenge. The response is always generic
   * ("If an account exists, an OTP has been sent") to prevent user enumeration.
   *
   * Rate limits are enforced per-destination and per-IP (5 starts per hour).
   */
  async forgotPassword(
    input: ForgotPasswordInput,
    ip: string,
  ): Promise<ForgotPasswordResponse> {
    const pool = getDbPool()

    try {
      // Look up user by normalized username
      const userResult = await pool.query(
        `SELECT user_id, username FROM users WHERE username = $1`,
        [input.username],
      )

      if (userResult.rows.length > 0) {
        // User found — create OTP challenge linked to the user
        const userId = userResult.rows[0].user_id

        await this.otpService.createLoginChallenge(
          userId,
          input.username,
          ip,
        )

        this.logger.log(`Forgot-password OTP sent for user ${userId} from ${ip}`)
      } else {
        // User not found — still return generic success (no enumeration)
        this.logger.log(
          `Forgot-password requested for unknown username ${input.username} from ${ip}`,
        )
      }

      // Always return generic success
      return {
        sent: true as const,
        message: 'If an account exists, an OTP has been sent.',
      }
    } catch (err) {
      // Re-throw rate-limit HttpExceptions
      if (err instanceof HttpException) throw err

      this.logger.error(
        `Forgot-password failed for ${input.username}: ${String(err)}`,
      )
      throw new HttpException(
        {
          statusCode: ErrorCodes.INTERNAL_SERVER.httpStatus,
          error: ErrorCodes.INTERNAL_SERVER.code,
        },
        ErrorCodes.INTERNAL_SERVER.httpStatus,
      )
    }
  }

  /**
   * Complete login after OTP verification (T-02.01.03).
   *
   * Atomically: verifies the OTP challenge (linked to a user) → creates session
   * → optionally marks device as trusted.
   *
   * Returns session credentials for the frontend.
   */
  async completeLogin(
    challengeId: string,
    otp: string,
    ip: string,
    trustDevice: boolean,
    deviceFingerprint?: string,
    userAgent?: string,
  ): Promise<LoginVerifyResponse> {
    const pool = getDbPool()
    const client = await pool.connect()
    let userId: string

    try {
      await client.query('BEGIN')

      // 1. Lock and fetch the challenge row
      const challengeResult = await client.query(
        `SELECT challenge_id, destination, otp_hash, attempts_remaining,
                expires_at, consumed_at, user_id
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

      const challengeRow = challengeResult.rows[0]

      // Check consumed
      if (challengeRow.consumed_at) {
        throw new HttpException(
          { statusCode: 409, error: ErrorCodes.AUTH_OTP_CONSUMED.code },
          409,
        )
      }

      // Check expiry
      if (new Date(challengeRow.expires_at) < new Date()) {
        throw new HttpException(
          { statusCode: 401, error: ErrorCodes.AUTH_OTP_EXPIRED.code },
          401,
        )
      }

      // Check attempts
      if (challengeRow.attempts_remaining <= 0) {
        throw new HttpException(
          { statusCode: 401, error: ErrorCodes.AUTH_OTP_MAX_ATTEMPTS.code },
          401,
        )
      }

      // Check user_id
      if (!challengeRow.user_id) {
        this.logger.error(`Login challenge ${challengeId} missing user_id`)
        throw new HttpException(
          { statusCode: 500, error: ErrorCodes.INTERNAL_UNEXPECTED.code },
          500,
        )
      }

      // 2. Verify OTP inside the transaction
      const submittedHash = this.otpService.hashOtp(otp)
      if (!this.otpService.compareOtpHashes(submittedHash, challengeRow.otp_hash)) {
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

      // 3. Consume OTP (in transaction)
      userId = challengeRow.user_id
      const now = new Date()

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

      await client.query('COMMIT')
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {})
      client.release()
      // Re-throw HttpExceptions as-is
      if (err instanceof HttpException) throw err
      this.logger.error(`Login OTP verify failed for challenge ${challengeId}: ${String(err)}`)
      throw new HttpException(
        { statusCode: 500, error: ErrorCodes.AUTH_LOGIN_FAILED.code },
        500,
      )
    }
    client.release()

    // ── Session creation (outside OTP transaction) ────────────
    try {
      const session = await this.sessionService.createSession(
        userId,
        false,
        { ip, ...(userAgent ? { userAgent } : {}), ...(deviceFingerprint ? { fingerprint: deviceFingerprint } : {}) },
      )

      // 5. Optionally mark device as trusted
      if (trustDevice && deviceFingerprint) {
        const trustNow = new Date()
        const trustExpiresAt = new Date(trustNow.getTime() + 30 * 24 * 60 * 60 * 1000)
        const trustId = uuidv7()

        const pool2 = getDbPool()
        await pool2.query(
          `INSERT INTO device_trusts (id, user_id, device_fingerprint, user_agent_hint, trusted_at, expires_at)
           VALUES ($1, $2, $3, $4, $5, $6)
           ON CONFLICT (user_id, device_fingerprint) DO UPDATE
             SET trusted_at = $5, expires_at = $6, updated_at = NOW()`,
          [trustId, userId, deviceFingerprint, userAgent ?? null, trustNow, trustExpiresAt],
        )

        this.logger.log(`Device trusted for user ${userId}`)
      }

      this.logger.log(`Login OTP verified: user ${userId} from ${ip}`)

      return {
        userId,
        sessionId: session.sessionId,
        csrfToken: session.csrfToken,
        refreshToken: session.refreshToken,
        expiresAt: session.expiresAt.toISOString(),
      }
    } catch (err) {
      this.logger.error(`Login OTP session creation failed for user ${userId}: ${String(err)}`)
      throw new HttpException(
        { statusCode: 500, error: ErrorCodes.AUTH_LOGIN_FAILED.code },
        500,
      )
    }
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
    let userId: string | undefined
    let row: any

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

      row = challengeResult.rows[0]

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

      // 3. Create user + consume OTP atomically (in transaction)
      userId = uuidv7()
      const now = new Date()

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

      // 4. Record TOS acceptance immutably in tos_acceptances (T-04.01.02)
      // Look up the current active TOS version UUID for the acceptance record
      const tosResult = await client.query(
        `SELECT id FROM tos_versions
         WHERE is_active = true
         ORDER BY published_at DESC
         LIMIT 1`,
      )

      const tosVersionId = tosResult.rows.length > 0
        ? tosResult.rows[0].id
        : null

      if (tosVersionId) {
        const acceptanceId = uuidv7()
        await client.query(
          `INSERT INTO tos_acceptances (id, user_id, version_id, accepted_at, ip_address, user_agent)
           VALUES ($1, $2, $3, $4, $5, $6)`,
          [acceptanceId, userId, tosVersionId, now, ip, null],
        )
      } else {
        this.logger.warn(
          `No active TOS version found during registration for user ${userId} — acceptance not recorded`,
        )
      }

      await client.query('COMMIT')
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {})
      client.release()
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
    }
    client.release()

    // ── Session creation (outside transaction) ────────────
    try {
      const session = await this.sessionService.createSession(
        userId,
        false,
        { ip },
      )

      this.logger.log(`User created: ${userId} (${row.destination}) from ${ip}`)

      return {
        userId,
        sessionId: session.sessionId,
        csrfToken: session.csrfToken,
        refreshToken: session.refreshToken,
        expiresAt: session.expiresAt.toISOString(),
      }
    } catch (err) {
      this.logger.error(`Registration session creation failed for user ${userId}: ${String(err)}`)
      throw new HttpException(
        {
          statusCode: ErrorCodes.AUTH_REGISTER_FAILED.httpStatus,
          error: ErrorCodes.AUTH_REGISTER_FAILED.code,
        },
        ErrorCodes.AUTH_REGISTER_FAILED.httpStatus,
      )
    }
  }

  /**
   * Reset password after OTP verification (T-02.03.02).
   *
   * Accepts a verified OTP challenge (from the forgot-password flow) and a
   * new password. Atomically:
   * 1. Verifies the OTP challenge (consumed, expired, attempts check).
   * 2. Checks password history to prevent reuse of the last 5 passwords.
   * 3. Records the current password in history.
   * 4. Updates the user's password hash.
   * 5. Invalidates ALL existing sessions and refresh tokens.
   * 6. Records a password_reset audit event.
   *
   * No session is established — the user must log in again with the new
   * password.
   *
   * Rate limits: 5 reset attempts per hour per destination (enforced by
   * the controller via @RateLimit).
   */
  async resetPassword(
    input: ResetPasswordInput,
    ip: string,
  ): Promise<ResetPasswordResponse> {
    const pool = getDbPool()
    const client = await pool.connect()

    try {
      await client.query('BEGIN')

      // 1. Lock and fetch the challenge row
      const challengeResult = await client.query(
        `SELECT challenge_id, destination, otp_hash, attempts_remaining,
                expires_at, consumed_at, user_id
         FROM otp_challenges
         WHERE challenge_id = $1
         FOR UPDATE`,
        [input.challengeId],
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

      // Check attempts remaining
      if (row.attempts_remaining <= 0) {
        throw new HttpException(
          { statusCode: 401, error: ErrorCodes.AUTH_OTP_MAX_ATTEMPTS.code },
          401,
        )
      }

      // Check user_id is set (forgot-password challenges set user_id)
      if (!row.user_id) {
        this.logger.error(`Reset-password challenge ${input.challengeId} missing user_id`)
        throw new HttpException(
          { statusCode: 400, error: ErrorCodes.VALIDATION_INPUT_INVALID.code },
          400,
        )
      }

      // 2. Verify OTP inside the transaction
      const submittedHash = this.otpService.hashOtp(input.otp)
      if (!this.otpService.compareOtpHashes(submittedHash, row.otp_hash)) {
        // Decrement attempts and commit the transaction
        await client.query(
          `UPDATE otp_challenges
           SET attempts_remaining = attempts_remaining - 1, updated_at = NOW()
           WHERE challenge_id = $1 AND attempts_remaining > 0`,
          [input.challengeId],
        )
        await client.query('COMMIT')

        throw new HttpException(
          { statusCode: 401, error: ErrorCodes.AUTH_OTP_INVALID.code },
          401,
        )
      }

      // 3. Consume OTP
      const now = new Date()
      const consumeResult = await client.query(
        `UPDATE otp_challenges
         SET consumed_at = $1, attempts_remaining = 0, updated_at = $1
         WHERE challenge_id = $2 AND consumed_at IS NULL`,
        [now, input.challengeId],
      )

      if (consumeResult.rowCount === 0) {
        throw new HttpException(
          { statusCode: 409, error: ErrorCodes.AUTH_OTP_CONSUMED.code },
          409,
        )
      }

      const userId = row.user_id

      // 4. Check password history (last 5 passwords)
      const historyResult = await client.query(
        `SELECT password_hash FROM password_history
         WHERE user_id = $1
         ORDER BY version DESC
         LIMIT 5`,
        [userId],
      )

      // Fetch current password hash
      const userResult = await client.query(
        `SELECT password_hash FROM users WHERE user_id = $1 FOR UPDATE`,
        [userId],
      )

      if (userResult.rows.length === 0) {
        throw new HttpException(
          { statusCode: 404, error: ErrorCodes.NOT_FOUND_RESOURCE.code },
          404,
        )
      }

      const currentHash = userResult.rows[0].password_hash
      const newHash = await argon2.hash(input.newPassword)

      // 4a. Check against current password
      const isSameAsCurrent = await argon2.verify(currentHash, input.newPassword).catch(() => false)
      if (isSameAsCurrent) {
        await client.query('ROLLBACK')
        this.logger.warn(`Password reuse (same as current) detected for user ${userId} from ${ip}`)
        throw new HttpException(
          { statusCode: 422, error: ErrorCodes.AUTH_LOGIN_PASSWORD_REUSED.code },
          422,
        )
      }

      // 4b. Check password history
      for (const entry of historyResult.rows) {
        const isReused = await argon2.verify(entry.password_hash, input.newPassword).catch(() => false)
        if (isReused) {
          await client.query('ROLLBACK')
          this.logger.warn(`Password reuse detected for user ${userId} from ${ip}`)
          throw new HttpException(
            { statusCode: 422, error: ErrorCodes.AUTH_LOGIN_PASSWORD_REUSED.code },
            422,
          )
        }
      }

      // 5. Record current password in history
      const version = historyResult.rows.length > 0
        ? historyResult.rows[0].version + 1
        : 1

      const historyId = uuidv7()

      await client.query(
        `INSERT INTO password_history (id, user_id, password_hash, version, created_at)
         VALUES ($1, $2, $3, $4, $5)`,
        [historyId, userId, currentHash, version, now],
      )

      // 6. Update user's password hash
      await client.query(
        `UPDATE users
         SET password_hash = $1, updated_at = $2
         WHERE user_id = $3`,
        [newHash, now, userId],
      )

      // 7. Invalidate ALL existing sessions and refresh tokens
      await client.query(
        `UPDATE sessions
         SET revoked_at = $1, updated_at = $1
         WHERE user_id = $2 AND revoked_at IS NULL`,
        [now, userId],
      )

      await client.query(
        `UPDATE refresh_tokens
         SET consumed_at = $1
         WHERE user_id = $2 AND consumed_at IS NULL`,
        [now, userId],
      )

      // 8. Record audit event
      const auditId = uuidv7()
      const correlationId = uuidv7()

      await client.query(
        `INSERT INTO audit_log (id, user_id, event, metadata, correlation_id, ip, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [auditId, userId, 'password_reset', null, correlationId, ip, now],
      )

      await client.query('COMMIT')

      this.logger.log(`Password reset for user ${userId} from ${ip}`)

      return {
        message: 'Your password has been reset. Please log in with your new password.',
      }
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {})
      if (err instanceof HttpException) throw err

      this.logger.error(`Password reset failed: ${String(err)}`)
      throw new HttpException(
        { statusCode: 500, error: ErrorCodes.INTERNAL_SERVER.code },
        500,
      )
    } finally {
      client.release()
    }
  }

  // ── Username / Contact Change (T-03.03.04) ────────────────────────

  /**
   * Get current user info (username, email, mobile).
   */
  async getUser(
    userId: string,
  ): Promise<{ userId: string; username: string; email: string | null; mobile: string | null }> {
    const pool = getDbPool()

    const result = await pool.query(
      `SELECT user_id, username, email, mobile FROM users WHERE user_id = $1`,
      [userId],
    )

    if (result.rows.length === 0) {
      throw new HttpException(
        { statusCode: 404, error: ErrorCodes.NOT_FOUND_RESOURCE.code },
        404,
      )
    }

    const row = result.rows[0]
    return {
      userId: row.user_id,
      username: row.username,
      email: row.email ?? null,
      mobile: row.mobile ?? null,
    }
  }

  /**
   * Send OTP to a new username to initiate a change.
   *
   * Validates the new username is not the same as the current one and is
   * not already taken. Creates an OTP challenge sent to the new destination.
   *
   * Rate limits are enforced via the controller's @RateLimit decorator.
   */
  async sendChangeUsernameOtp(
    userId: string,
    newUsername: string,
    ip: string,
  ): Promise<{ challengeId: string; destination: string }> {
    const pool = getDbPool()

    // 1. Fetch current user
    const userResult = await pool.query(
      `SELECT username FROM users WHERE user_id = $1`,
      [userId],
    )

    if (userResult.rows.length === 0) {
      throw new HttpException(
        { statusCode: 404, error: ErrorCodes.NOT_FOUND_RESOURCE.code },
        404,
      )
    }

    const currentUsername = userResult.rows[0].username

    // 2. Check it's not the same
    if (currentUsername === newUsername) {
      throw new HttpException(
        { statusCode: 400, error: ErrorCodes.AUTH_CHANGE_USERNAME_SAME.code },
        400,
      )
    }

    // 3. Check uniqueness
    const takenResult = await pool.query(
      `SELECT 1 FROM users WHERE username = $1 LIMIT 1`,
      [newUsername],
    )

    if (takenResult.rows.length > 0) {
      throw new HttpException(
        { statusCode: 409, error: ErrorCodes.AUTH_CHANGE_USERNAME_TAKEN.code },
        409,
      )
    }

    // 4. Create OTP challenge
    return this.otpService.createChallenge(newUsername, ip)
  }

  /**
   * Complete a username change after OTP verification.
   *
   * Atomically: verifies OTP → updates username → invalidates all other
   * sessions (keeping the current one). Records an audit event.
   */
  async completeChangeUsername(
    userId: string,
    newUsername: string,
    challengeId: string,
    otp: string,
    ip: string,
    currentSessionId: string,
  ): Promise<{ message: string }> {
    const pool = getDbPool()
    const client = await pool.connect()

    try {
      await client.query('BEGIN')

      // 1. Verify the challenge was created for this destination
      const challengeResult = await client.query(
        `SELECT destination FROM otp_challenges
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

      const challengeDestination = challengeResult.rows[0].destination

      // Verify the challenge was created for the new username (operation scoping)
      if (challengeDestination !== newUsername) {
        this.logger.warn(
          `Challenge destination mismatch: challenge ${challengeId} was for ${challengeDestination} but request is for ${newUsername}`,
        )
        throw new HttpException(
          { statusCode: 400, error: ErrorCodes.AUTH_CHANGE_USERNAME_INVALID.code },
          400,
        )
      }

      // 2. Verify OTP (consumes the challenge atomically)
      await this.otpService.verifyChallenge(challengeId, otp, ip)

      // 3. Re-check uniqueness inside the transaction
      const takenResult = await client.query(
        `SELECT 1 FROM users WHERE username = $1 AND user_id != $2 LIMIT 1`,
        [newUsername, userId],
      )

      if (takenResult.rows.length > 0) {
        throw new HttpException(
          { statusCode: 409, error: ErrorCodes.AUTH_CHANGE_USERNAME_TAKEN.code },
          409,
        )
      }

      // 3. Determine contact columns based on username type
      const emailRe = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
      const isNewEmail = emailRe.test(newUsername)
      const userResult = await client.query(
        `SELECT email, mobile FROM users WHERE user_id = $1 FOR UPDATE`,
        [userId],
      )

      if (userResult.rows.length === 0) {
        throw new HttpException(
          { statusCode: 404, error: ErrorCodes.NOT_FOUND_RESOURCE.code },
          404,
        )
      }

      const currentUser = userResult.rows[0]
      const now = new Date()

      // Update username and the corresponding contact column
      if (isNewEmail) {
        try {
          await client.query(
            `UPDATE users
             SET username = $1, email = $1, updated_at = $2
             WHERE user_id = $3`,
            [newUsername, now, userId],
          )
        } catch (err: any) {
          if (err?.code === '23505') {
            // Unique constraint violation — another user claimed this username
            throw new HttpException(
              { statusCode: 409, error: ErrorCodes.AUTH_CHANGE_USERNAME_TAKEN.code },
              409,
            )
          }
          throw err
        }
      } else {
        // It's a mobile number
        try {
          await client.query(
            `UPDATE users
             SET username = $1, mobile = $1, updated_at = $2
             WHERE user_id = $3`,
            [newUsername, now, userId],
          )
        } catch (err: any) {
          if (err?.code === '23505') {
            // Unique constraint violation — another user claimed this username
            throw new HttpException(
              { statusCode: 409, error: ErrorCodes.AUTH_CHANGE_USERNAME_TAKEN.code },
              409,
            )
          }
          throw err
        }
      }

      // 4. Invalidate all other sessions (keep current)
      await client.query(
        `UPDATE sessions
         SET revoked_at = $1, updated_at = $1
         WHERE user_id = $2 AND session_id != $3 AND revoked_at IS NULL`,
        [now, userId, currentSessionId],
      )

      // 5. Record audit event
      const auditId = uuidv7()
      const correlationId = uuidv7()
      await client.query(
        `INSERT INTO audit_log (id, user_id, event, metadata, correlation_id, ip, created_at)
         VALUES ($1, $2, $3, $4::jsonb, $5, $6, $7)`,
        [auditId, userId, 'username_changed', JSON.stringify({ oldUsername: currentUser.username, newUsername }), correlationId, ip, now],
      )

      await client.query('COMMIT')

      this.logger.log(`Username changed: user ${userId} from ${ip} (${currentUser.username} → ${newUsername})`)

      return { message: 'Username changed successfully.' }
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {})
      if (err instanceof HttpException) throw err
      this.logger.error(`Username change failed for user ${userId}: ${String(err)}`)
      throw new HttpException(
        { statusCode: 500, error: ErrorCodes.INTERNAL_SERVER.code },
        500,
      )
    } finally {
      client.release()
    }
  }

  /**
   * Send OTP to a new contact value (email or mobile) to add it.
   *
   * Validates the user doesn't already have the requested contact type.
   * If the user was registered with email, they can add a mobile and vice versa.
   */
  async sendAddContactOtp(
    userId: string,
    contactType: 'email' | 'mobile',
    contactValue: string,
    ip: string,
  ): Promise<{ challengeId: string; destination: string }> {
    const pool = getDbPool()

    // 1. Check current user's contact fields
    const userResult = await pool.query(
      `SELECT email, mobile FROM users WHERE user_id = $1`,
      [userId],
    )

    if (userResult.rows.length === 0) {
      throw new HttpException(
        { statusCode: 404, error: ErrorCodes.NOT_FOUND_RESOURCE.code },
        404,
      )
    }

    const user = userResult.rows[0]

    // 2. Validate the user doesn't already have this contact type
    if (contactType === 'email' && user.email) {
      throw new HttpException(
        { statusCode: 409, error: ErrorCodes.AUTH_CHANGE_USERNAME_ALREADY_HAS_EMAIL.code },
        409,
      )
    }

    if (contactType === 'mobile' && user.mobile) {
      throw new HttpException(
        { statusCode: 409, error: ErrorCodes.AUTH_CHANGE_USERNAME_ALREADY_HAS_MOBILE.code },
        409,
      )
    }

    // 3. Validate the contact value is appropriate
    if (contactType === 'email') {
      const emailRe = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
      if (!emailRe.test(contactValue)) {
        throw new HttpException(
          { statusCode: 400, error: ErrorCodes.AUTH_CHANGE_USERNAME_INVALID.code },
          400,
        )
      }
    } else {
      // mobile — must be E.164
      const e164Re = /^\+[1-9]\d{6,14}$/
      if (!e164Re.test(contactValue)) {
        throw new HttpException(
          { statusCode: 400, error: ErrorCodes.AUTH_CHANGE_USERNAME_INVALID.code },
          400,
        )
      }
    }

    // 4. Create OTP challenge
    return this.otpService.createChallenge(contactValue, ip)
  }

  /**
   * Complete adding a contact after OTP verification.
   *
   * Atomically: verifies OTP → updates the contact column.
   */
  async completeAddContact(
    userId: string,
    contactType: 'email' | 'mobile',
    contactValue: string,
    challengeId: string,
    otp: string,
    ip: string,
  ): Promise<{ message: string }> {
    const pool = getDbPool()
    const client = await pool.connect()

    try {
      await client.query('BEGIN')

      // 1. Verify the challenge was created for this destination
      const challengeResult = await client.query(
        `SELECT destination FROM otp_challenges
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

      const challengeDestination = challengeResult.rows[0].destination

      // Verify the challenge was created for the contact value (operation scoping)
      if (challengeDestination !== contactValue) {
        this.logger.warn(
          `Challenge destination mismatch: challenge ${challengeId} was for ${challengeDestination} but request is for ${contactValue}`,
        )
        throw new HttpException(
          { statusCode: 400, error: ErrorCodes.AUTH_CHANGE_USERNAME_INVALID.code },
          400,
        )
      }

      // 2. Verify OTP
      await this.otpService.verifyChallenge(challengeId, otp, ip)

      // 2. Re-check user doesn't already have this contact type
      const userResult = await client.query(
        `SELECT email, mobile FROM users WHERE user_id = $1 FOR UPDATE`,
        [userId],
      )

      if (userResult.rows.length === 0) {
        throw new HttpException(
          { statusCode: 404, error: ErrorCodes.NOT_FOUND_RESOURCE.code },
          404,
        )
      }

      const user = userResult.rows[0]

      if (contactType === 'email' && user.email) {
        throw new HttpException(
          { statusCode: 409, error: ErrorCodes.AUTH_CHANGE_USERNAME_ALREADY_HAS_EMAIL.code },
          409,
        )
      }

      if (contactType === 'mobile' && user.mobile) {
        throw new HttpException(
          { statusCode: 409, error: ErrorCodes.AUTH_CHANGE_USERNAME_ALREADY_HAS_MOBILE.code },
          409,
        )
      }

      // 3. Update the contact column
      const now = new Date()
      const column = contactType === 'email' ? 'email' : 'mobile'
      await client.query(
        `UPDATE users SET ${column} = $1, updated_at = $2 WHERE user_id = $3`,
        [contactValue, now, userId],
      )

      // 4. Record audit event
      const auditId = uuidv7()
      const correlationId = uuidv7()
      await client.query(
        `INSERT INTO audit_log (id, user_id, event, metadata, correlation_id, ip, created_at)
         VALUES ($1, $2, $3, $4::jsonb, $5, $6, $7)`,
        [auditId, userId, 'contact_added', JSON.stringify({ contactType, contactValue }), correlationId, ip, now],
      )

      await client.query('COMMIT')

      this.logger.log(`Contact added: user ${userId} ${contactType}=${contactValue} from ${ip}`)

      return { message: 'Contact added successfully.' }
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {})
      if (err instanceof HttpException) throw err
      this.logger.error(`Add contact failed for user ${userId}: ${String(err)}`)
      throw new HttpException(
        { statusCode: 500, error: ErrorCodes.INTERNAL_SERVER.code },
        500,
      )
    } finally {
      client.release()
    }
  }
}