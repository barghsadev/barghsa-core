import { HttpException, Injectable, Logger } from '@nestjs/common';
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import type { PoolClient } from 'pg';
import { v7 as uuidv7 } from 'uuid';
import * as argon2 from 'argon2';
import { PASSWORD_HASH_OPTIONS } from '@barghsa/shared/password-hash';
import { getDbPool } from '@barghsa/db';
import { ErrorCodes } from '@barghsa/shared/errors';
import { rateLimitKey } from '@barghsa/shared/rate-limit';
import type { RegisterInput, RegisterResponse } from './dto/register.dto.js';
import type { RegisterVerifyResponse } from './dto/otp.dto.js';
import type { LoginInput, LoginResponse, LoginVerifyResponse } from './dto/login.dto.js';
import type {
  ForceChangePasswordInput,
  ForceChangePasswordResponse,
} from './dto/force-change-password.dto.js';
import type { ForgotPasswordInput, ForgotPasswordResponse } from './dto/forgot-password.dto.js';
import type {
  ResetPasswordInput,
  ResetPasswordResponse,
  VerifyResetOtpInput,
  VerifyResetOtpResponse,
} from './dto/reset-password.dto.js';
import { OtpService, OtpAttemptRejected } from './otp.service.js';
import {
  DeviceTrustRequired,
  SessionService,
  type CreatedSession,
} from '../session/session.service.js';
import { RateLimitService } from '../rate-limit/rate-limit.service.js';
import { TosService } from '../tos/tos.service.js';
import { deviceTrustIp } from './device-trust-ip.js';
import { correlationIdStorage } from '../common/correlation-id.middleware.js';

/**
 * Service handling registration and login business logic.
 *
 * Creates user records, verifies credentials with Argon2id,
 * and delegates session creation to SessionService (T-02.02.01).
 */
@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  /**
   * Pre-computed Argon2id hash of a dummy string, used to equalize response
   * timing when the username is not found — prevents user enumeration via
   * timing side-channel (T-02.01.02 hardening).
   * Lazy-initialized so module load doesn't block on hashing.
   */
  private static _dummyHash: string | null = null;
  private static _dummyHashPromise: Promise<void> | null = null;

  constructor(
    private readonly otpService: OtpService,
    private readonly sessionService: SessionService,
    private readonly rateLimitService: RateLimitService,
    private readonly tosService: TosService
  ) {}

  /**
   * Kick off the dummy hash computation so it's ready by the time a login
   * request arrives. Caches the result in _dummyHash.
   * Errors (e.g. argon2 mock in test) are silently caught — without the
   * dummy hash, the timing side-channel guard simply degrades gracefully.
   */
  private async ensureDummyHash(): Promise<void> {
    if (AuthService._dummyHash) return;
    if (!AuthService._dummyHashPromise) {
      AuthService._dummyHashPromise = argon2
        .hash('__barghsa_timing_constant__', PASSWORD_HASH_OPTIONS)
        .then((hash) => {
          AuthService._dummyHash = hash;
        })
        .catch(() => {
          // argon2 mock or unavailability — timing guard degrades gracefully
          AuthService._dummyHashPromise = null;
        });
    }
    return AuthService._dummyHashPromise;
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
    deviceToken?: string
  ): Promise<RegisterResponse> {
    await this.rateLimitService.enforceSecurityRateLimit(
      rateLimitKey(
        'registration:destination',
        createHash('sha256').update(input.username).digest('hex')
      ),
      10,
      3_600_000
    );
    const client = await getDbPool().connect();
    try {
      await client.query('BEGIN');
      // Serialize starts by canonical destination across every API process.
      await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [
        `registration:${input.username}`,
      ]);
      const pending = await client.query<{
        challenge_id: string;
        password_hash: string;
      }>(
        `SELECT challenge_id,password_hash FROM otp_challenges
         WHERE destination=$1 AND purpose='registration' AND tos_version_id=$2
           AND password_hash IS NOT NULL AND consumed_at IS NULL AND attempts_remaining>0
           AND expires_at>clock_timestamp()
         ORDER BY created_at DESC,challenge_id FOR UPDATE`,
        [input.username, input.tosVersionId]
      );
      const existing = await client.query(
        'SELECT 1 FROM account_login_identifiers WHERE destination=$1',
        [input.username]
      );
      if (existing.rows.length) {
        throw new HttpException(
          {
            statusCode: ErrorCodes.AUTH_REGISTER_USERNAME_TAKEN.httpStatus,
            error: ErrorCodes.AUTH_REGISTER_USERNAME_TAKEN.code,
          },
          ErrorCodes.AUTH_REGISTER_USERNAME_TAKEN.httpStatus
        );
      }

      // Verify the salted password hash to compare complete requests without
      // persisting a fast password fingerprint or a second copy of the secret.
      for (const candidate of pending.rows) {
        if (!(await argon2.verify(candidate.password_hash, input.password))) continue;
        const current = await client.query(
          'SELECT expires_at>clock_timestamp() AS valid FROM otp_challenges WHERE challenge_id=$1',
          [candidate.challenge_id]
        );
        if (!current.rows[0]?.valid) continue;
        await client.query('COMMIT');
        return { challengeId: candidate.challenge_id };
      }

      // Bind consent to the published version actually shown by the client.
      const terms = await client.query(
        `SELECT id FROM tos_versions WHERE id::text=$1 AND is_active=true
       AND status='published' AND published_at IS NOT NULL`,
        [input.tosVersionId]
      );
      if (!terms.rows.length) {
        throw new HttpException(
          {
            statusCode: ErrorCodes.AUTH_REGISTER_TOS_NOT_ACCEPTED.httpStatus,
            error: ErrorCodes.AUTH_REGISTER_TOS_NOT_ACCEPTED.code,
          },
          ErrorCodes.AUTH_REGISTER_TOS_NOT_ACCEPTED.httpStatus
        );
      }

      const passwordHash = await argon2.hash(input.password, PASSWORD_HASH_OPTIONS);
      const { challengeId } = await this.otpService.createRegistrationChallenge(
        input.username,
        ip,
        passwordHash,
        input.tosVersionId,
        client,
        deviceToken
      );
      await client.query('COMMIT');
      return { challengeId };
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * Authenticate a user with username + password credentials.
   *
   * Uses Argon2id to verify the parameters encoded in the stored hash.
   *
   * Steps:
   * 1. Look up user by normalized username
   * 2. Verify password hash with Argon2id
   * 3. Require OTP for staff, unknown devices, changed addresses or expired trust
   * 4. If no OTP needed → create session atomically
   * 5. If OTP needed → create a login OTP challenge
   *
   * Error is always a generic "invalid credentials" — never distinguishes
   * between "user not found" and "wrong password" to prevent enumeration.
   */
  async login(input: LoginInput, ip: string): Promise<LoginResponse> {
    const pool = getDbPool();

    if (input.deviceInfo?.fingerprint) {
      await this.rateLimitService.enforceSecurityRateLimit(
        rateLimitKey(
          'login:device',
          createHash('sha256').update(input.deviceInfo.fingerprint).digest('hex')
        ),
        50,
        900_000
      );
    }

    // Wait for the shared dummy hash, including the first login after startup.
    await this.ensureDummyHash();

    // Keep account-specific failures separate from the broad IP request guard.
    // Hash the tuple so delimiters cannot collide and account names are not logged.
    const delayForFailures = async (previousFailures: number) => {
      if (previousFailures < 5) return;
      const delayMs = Math.min(500 * 2 ** Math.min(previousFailures - 5, 4), 5000);
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    };

    try {
      // 1. Look up user by normalized username
      const userResult = await pool.query(
        `SELECT u.user_id,u.username,u.password_hash,u.must_change_password,
                u.password_change_token,u.password_change_token_expires_at,u.is_admin,u.is_staff,u.disabled_at,u.auth_version
         FROM users u JOIN account_login_identifiers i ON i.user_id=u.user_id
         WHERE i.destination=$1`,
        [input.username]
      );

      const userFound = userResult.rows.length > 0;
      const rateLimitKeyStr = rateLimitKey(
        'login:failures',
        createHash('sha256')
          .update(
            JSON.stringify([userResult.rows[0]?.username?.toLowerCase() ?? input.username, ip])
          )
          .digest('hex')
      );
      const dummyHash = AuthService._dummyHash;

      // 2. Verify password with Argon2id (falling through to dummy hash
      //    when user not found, to equalize response timing)
      let passwordValid = false;

      if (userFound) {
        try {
          passwordValid = await argon2.verify(userResult.rows[0].password_hash, input.password);
        } catch {
          // Corrupted or malformed password_hash — treat as invalid credential
          // without revealing internal hash format details
        }
      } else if (dummyHash) {
        try {
          await argon2.verify(dummyHash, input.password);
        } catch {
          // Hash verification failure still returns the generic credential error.
        }
      }

      if (!userFound || !passwordValid) {
        // Atomic increment counts only credential failures, including simultaneous
        // failures. The sixth failure waits even when all six started together.
        // Ten failures already reach the maximum delay. Retaining the latest
        // eleven preserves every lower threshold as older failures expire.
        const ceiling = 10;
        const counter = await this.rateLimitService.checkSecurityRateLimit(
          rateLimitKeyStr,
          ceiling,
          900_000
        );
        await delayForFailures(ceiling - counter.remaining - 1);
        throw new HttpException(
          { statusCode: 401, error: ErrorCodes.AUTH_LOGIN_INVALID_CREDENTIALS.code },
          401
        );
      }

      await delayForFailures(
        await this.rateLimitService.getSecurityCount(rateLimitKeyStr, 900_000)
      );

      // 3b. Extract user properties
      const userId = userResult.rows[0].user_id;
      let isStaff = userResult.rows[0].is_admin === true || userResult.rows[0].is_staff === true;

      // 3b2. Reject disabled accounts (T-10.01.01). Checked *after* the
      // password verifies so account existence is not leaked to callers
      // without valid credentials (same ordering as the must-change-password
      // branch below). A disabled account never gets a password-change token,
      // a session, or an OTP challenge.
      if (userResult.rows[0].disabled_at) {
        this.logger.warn(`Login blocked for disabled user ${userId} from ${ip}`);
        throw new HttpException(
          { statusCode: 403, error: ErrorCodes.AUTH_ACCOUNT_DISABLED.code },
          403
        );
      }

      // 3c. Check if user must change password (T-02.01.04)
      // NOTE: This check intentionally precedes MFA/OTP enforcement (step 4).
      // No session is established for the must-change-password flow, so the
      // user must re-authenticate (with MFA if required) after the password
      // change. MFA is therefore deferred rather than skipped.
      const mustChangePassword = userResult.rows[0].must_change_password ?? false;

      if (mustChangePassword) {
        // Generate a short-lived token to authorize the password change
        const passwordChangeToken = uuidv7();
        const tokenExpiry = new Date(Date.now() + 5 * 60 * 1000); // 5 minutes

        const issued = await pool.query(
          `UPDATE users
           SET password_change_token = $1, password_change_token_expires_at = $2, updated_at = NOW()
           WHERE user_id = $3 AND auth_version = $4`,
          [passwordChangeToken, tokenExpiry, userId, userResult.rows[0].auth_version]
        );

        if (issued.rowCount === 0) {
          throw new HttpException(
            { statusCode: 401, error: ErrorCodes.AUTH_TOKEN_INVALID.code },
            401
          );
        }

        this.logger.log(`Password change required for user ${userId} from ${ip}`);

        return {
          requiresOtp: false,
          mustChangePassword: true,
          passwordChangeToken,
        };
      }

      // 4. Check if risk-based OTP enforcement is needed (T-02.01.03)
      const deviceFingerprint = input.deviceInfo?.fingerprint
        ? createHash('sha256').update(input.deviceInfo.fingerprint).digest('hex')
        : null;
      const trustedIp = deviceTrustIp(ip);

      let session: CreatedSession | undefined;
      if (deviceFingerprint && trustedIp && !isStaff) {
        try {
          session = await this.sessionService.createSession(
            userId,
            false,
            {
              ip,
              ...(input.deviceInfo?.userAgent ? { userAgent: input.deviceInfo.userAgent } : {}),
              fingerprint: deviceFingerprint,
            },
            userResult.rows[0].auth_version,
            undefined,
            { fingerprint: deviceFingerprint, ip: trustedIp }
          );
        } catch (error) {
          if (!(error instanceof DeviceTrustRequired)) throw error;
          isStaff = error.isStaff;
        }
      }

      if (!session) {
        const { challengeId } = await this.otpService.createLoginChallenge(
          userId,
          input.username,
          ip,
          'login',
          userResult.rows[0].auth_version,
          input.deviceInfo?.fingerprint
        );

        this.logger.log(`OTP challenge created for login: user ${userId} from ${ip}`);

        return {
          requiresOtp: true,
          challengeId,
          userIsStaff: isStaff,
        };
      }

      // Record last successful login (T-10.01.01) — best-effort; a failed
      // analytics write must never fail the login itself.
      await pool
        .query(`UPDATE users SET last_login_at = NOW() WHERE user_id = $1`, [userId])
        .catch(() => {
          // Non-critical — the login already succeeded
        });

      // Reset rate-limit counters on successful login
      await this.rateLimitService.resetSecurityRateLimit(rateLimitKeyStr).catch(() => {
        // Non-critical — counter will expire naturally
      });

      this.logger.log(`User logged in: ${userId} (${input.username}) from ${ip}`);

      return {
        requiresOtp: false,
        userId,
        sessionId: session.sessionId,
        csrfToken: session.csrfToken,
        refreshToken: session.refreshToken,
        expiresAt: session.expiresAt.toISOString(),
      };
    } catch (err) {
      // Re-throw HttpExceptions as-is (safe structured errors)
      if (err instanceof HttpException) throw err;

      this.logger.error(`Login failed for user ${input.username}: ${String(err)}`);
      throw new HttpException({ statusCode: 500, error: ErrorCodes.AUTH_LOGIN_FAILED.code }, 500);
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
    ip: string
  ): Promise<ForceChangePasswordResponse> {
    const pool = getDbPool();
    const client = await pool.connect();

    try {
      await client.query('BEGIN');

      // 1. Look up the user by password change token
      const userResult = await client.query(
        `SELECT user_id, password_hash, must_change_password, disabled_at,
                password_change_token, password_change_token_expires_at
         FROM users
         WHERE password_change_token = $1
         FOR UPDATE`,
        [input.passwordChangeToken]
      );

      if (userResult.rows.length === 0) {
        throw new HttpException(
          { statusCode: 400, error: ErrorCodes.AUTH_LOGIN_MUST_CHANGE_PASSWORD.code },
          400
        );
      }

      const user = userResult.rows[0];

      // 2. Verify the token hasn't expired
      if (!user.must_change_password || user.disabled_at) {
        throw new HttpException(
          { statusCode: 400, error: ErrorCodes.AUTH_LOGIN_MUST_CHANGE_PASSWORD.code },
          400
        );
      }

      const tokenExpiresAt = new Date(user.password_change_token_expires_at).getTime();
      if (!Number.isFinite(tokenExpiresAt) || tokenExpiresAt <= Date.now()) {
        throw new HttpException(
          { statusCode: 400, error: ErrorCodes.AUTH_LOGIN_MUST_CHANGE_PASSWORD.code },
          400
        );
      }

      // 3. Check password history (last 5 passwords)
      const historyResult = await client.query(
        `SELECT password_hash, version FROM password_history
         WHERE user_id = $1
         ORDER BY version DESC
         LIMIT 5`,
        [user.user_id]
      );

      const newHash = await argon2.hash(input.newPassword, PASSWORD_HASH_OPTIONS);

      // 3a. Check against the current password (must differ from current)
      const isSameAsCurrent = await argon2.verify(user.password_hash, input.newPassword);
      if (isSameAsCurrent) {
        await client.query('ROLLBACK');
        this.logger.warn(
          `Password reuse (same as current) detected for user ${user.user_id} from ${ip}`
        );
        throw new HttpException(
          { statusCode: 422, error: ErrorCodes.AUTH_LOGIN_PASSWORD_REUSED.code },
          422
        );
      }

      // 3b. Check password history (last 5 passwords)
      for (const entry of historyResult.rows) {
        const isReused = await argon2.verify(entry.password_hash, input.newPassword);
        if (isReused) {
          await client.query('ROLLBACK');
          this.logger.warn(`Password reuse detected for user ${user.user_id} from ${ip}`);
          throw new HttpException(
            { statusCode: 422, error: ErrorCodes.AUTH_LOGIN_PASSWORD_REUSED.code },
            422
          );
        }
      }

      // 4. Record current password in history, then update user
      const version = historyResult.rows.length > 0 ? historyResult.rows[0].version + 1 : 1;

      const historyId = uuidv7();
      const now = new Date();

      // Insert old password into history
      await client.query(
        `INSERT INTO password_history (id, user_id, password_hash, version, created_at)
         VALUES ($1, $2, $3, $4, $5)`,
        [historyId, user.user_id, user.password_hash, version, now]
      );

      // Update user: new password hash, clear change flag and token
      await client.query(
        `UPDATE users
         SET password_hash = $1,
             must_change_password = false,
             password_change_token = NULL,
             password_change_token_expires_at = NULL,
             updated_at = $2
         WHERE user_id = $3`,
        [newHash, now, user.user_id]
      );

      // Changing credentials invalidates every existing session and its CSRF
      // token, including sessions opened before the forced-change flag was set.
      await client.query(
        `UPDATE sessions SET revoked_at = $1, updated_at = $1
         WHERE user_id = $2 AND revoked_at IS NULL`,
        [now, user.user_id]
      );
      await client.query(
        `UPDATE refresh_tokens SET consumed_at = $1
         WHERE user_id = $2 AND consumed_at IS NULL`,
        [now, user.user_id]
      );

      await client.query(
        `INSERT INTO audit_log(id,user_id,event,metadata,correlation_id,ip,created_at)
         VALUES ($1,$2,'password_changed',$3,$4,$5,clock_timestamp())`,
        [
          uuidv7(),
          user.user_id,
          JSON.stringify({ reason: 'forced_change' }),
          correlationIdStorage.getStore() ?? uuidv7(),
          ip,
        ]
      );
      // Hashing and credential/session writes may outlast the token deadline.
      // Keep every effect provisional until its final wall-clock check.
      const currentToken = await client.query('SELECT $1::timestamptz>clock_timestamp() AS valid', [
        user.password_change_token_expires_at,
      ]);
      if (!currentToken.rows[0]?.valid) {
        throw new HttpException(
          { statusCode: 400, error: ErrorCodes.AUTH_LOGIN_MUST_CHANGE_PASSWORD.code },
          400
        );
      }

      await client.query('COMMIT');

      this.logger.log(`Password changed for user ${user.user_id} from ${ip}`);

      return {
        message: 'Password changed successfully. Please log in with your new password.',
      };
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});

      if (err instanceof HttpException) throw err;

      this.logger.error(`Force password change failed: ${String(err)}`);
      throw new HttpException({ statusCode: 500, error: ErrorCodes.INTERNAL_SERVER.code }, 500);
    } finally {
      client.release();
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
    deviceToken?: string
  ): Promise<ForgotPasswordResponse> {
    await this.rateLimitService.enforceSecurityRateLimit(
      rateLimitKey(
        'password-reset:destination',
        createHash('sha256').update(input.username).digest('hex')
      ),
      5,
      3_600_000
    );
    const { challengeId } = await this.otpService.createPasswordResetChallenge(
      input.username,
      ip,
      deviceToken
    );
    return {
      challengeId,
      sent: true,
      message: 'If an account exists, a verification code has been queued.',
    };
  }

  async activateStaff(
    token: string,
    newPassword: string,
    ip: string
  ): Promise<{ activated: true }> {
    const tokenHash = createHash('sha256').update(token).digest('hex');
    const passwordHash = await argon2.hash(newPassword, PASSWORD_HASH_OPTIONS);
    const client = await getDbPool().connect();
    try {
      await client.query('BEGIN');
      const account = await client.query<{ user_id: string; activation_token_expires_at: Date }>(
        `SELECT user_id,activation_token_expires_at FROM users
        WHERE activation_token=$1 AND is_staff=true AND disabled_at IS NULL FOR UPDATE`,
        [tokenHash]
      );
      if (account.rows.length !== 1)
        throw new HttpException(
          { statusCode: 401, error: ErrorCodes.AUTH_TOKEN_INVALID.code },
          401
        );
      const userId = account.rows[0]!.user_id;
      const checkDeadline = async () => {
        const deadline = await client.query('SELECT $1::timestamptz>clock_timestamp() AS valid', [
          account.rows[0]!.activation_token_expires_at,
        ]);
        if (!deadline.rows[0]?.valid)
          throw new HttpException(
            { statusCode: 401, error: ErrorCodes.AUTH_TOKEN_INVALID.code },
            401
          );
      };
      await checkDeadline();
      await client.query(
        `UPDATE users SET password_hash=$1,must_change_password=false,activation_token=NULL,
        activation_token_expires_at=NULL,updated_at=NOW() WHERE user_id=$2`,
        [passwordHash, userId]
      );
      await client.query(
        'UPDATE sessions SET revoked_at=NOW() WHERE user_id=$1 AND revoked_at IS NULL',
        [userId]
      );
      await client.query(
        'UPDATE refresh_tokens SET consumed_at=NOW() WHERE user_id=$1 AND consumed_at IS NULL',
        [userId]
      );
      await client.query(
        `INSERT INTO audit_log(id,user_id,event,metadata,correlation_id,ip,created_at)
        VALUES ($1,$2,'staff_user_activated',$3,$4,$5,NOW())`,
        [uuidv7(), userId, JSON.stringify({ targetUserId: userId }), uuidv7(), ip]
      );
      // Recheck expiry after credential and audit writes, which may wait on locks.
      await checkDeadline();
      await client.query('COMMIT');
      return { activated: true };
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      throw error;
    } finally {
      client.release();
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
    userAgent?: string
  ): Promise<LoginVerifyResponse> {
    const pool = getDbPool();
    const client = await pool.connect();
    let userId: string;
    let authVersion: number;

    try {
      await client.query('BEGIN');

      // 1. Lock and fetch the challenge row
      const challengeResult = await client.query(
        `SELECT challenge_id, destination, otp_hash, attempts_remaining,
                expires_at, consumed_at, user_id, auth_version
         FROM otp_challenges
         WHERE challenge_id = $1 AND purpose = 'login'
         FOR UPDATE`,
        [challengeId]
      );

      if (challengeResult.rows.length === 0) {
        throw new HttpException(
          { statusCode: 404, error: ErrorCodes.NOT_FOUND_RESOURCE.code },
          404
        );
      }

      const challengeRow = challengeResult.rows[0];

      // Check consumed
      if (challengeRow.consumed_at) {
        throw new HttpException({ statusCode: 409, error: ErrorCodes.AUTH_OTP_CONSUMED.code }, 409);
      }

      // Check expiry
      if (new Date(challengeRow.expires_at) < new Date()) {
        throw new HttpException({ statusCode: 401, error: ErrorCodes.AUTH_OTP_EXPIRED.code }, 401);
      }

      // Check attempts
      if (challengeRow.attempts_remaining <= 0) {
        throw new HttpException(
          { statusCode: 401, error: ErrorCodes.AUTH_OTP_MAX_ATTEMPTS.code },
          401
        );
      }

      // Check user_id
      if (!challengeRow.user_id) {
        this.logger.error(`Login challenge ${challengeId} missing user_id`);
        throw new HttpException(
          { statusCode: 500, error: ErrorCodes.INTERNAL_UNEXPECTED.code },
          500
        );
      }

      // 1b. Reject disabled accounts (T-10.01.01) — the OTP grants a fresh
      // session, so it must not complete for a disabled account. Thrown
      // inside the transaction; the catch below rolls back and re-throws.
      const challengeUserStatus = await client.query(
        `SELECT disabled_at,username FROM users WHERE user_id = $1`,
        [challengeRow.user_id]
      );
      if (challengeUserStatus.rows.length > 0 && challengeUserStatus.rows[0].disabled_at) {
        this.logger.warn(`OTP login blocked for disabled user ${challengeRow.user_id} from ${ip}`);
        throw new HttpException(
          { statusCode: 403, error: ErrorCodes.AUTH_ACCOUNT_DISABLED.code },
          403
        );
      }

      await this.otpService.assertCurrentAccount(
        challengeRow.user_id,
        challengeRow.auth_version,
        client
      );
      authVersion = challengeRow.auth_version;

      // The account lock may have waited beyond the challenge deadline.
      if (new Date(challengeRow.expires_at).getTime() <= Date.now()) {
        throw new HttpException({ statusCode: 401, error: ErrorCodes.AUTH_OTP_EXPIRED.code }, 401);
      }

      // 2. Verify OTP inside the transaction
      const submittedHash = this.otpService.hashOtp(otp);
      if (!this.otpService.compareOtpHashes(submittedHash, challengeRow.otp_hash)) {
        // Decrement attempts inside the transaction and commit
        await client.query(
          `UPDATE otp_challenges
           SET attempts_remaining = attempts_remaining - 1, updated_at = NOW()
           WHERE challenge_id = $1 AND attempts_remaining > 0`,
          [challengeId]
        );
        await client.query('COMMIT');

        throw new HttpException({ statusCode: 401, error: ErrorCodes.AUTH_OTP_INVALID.code }, 401);
      }

      // 3. Consume OTP (in transaction)
      userId = challengeRow.user_id;
      const now = new Date();

      // Consume the OTP challenge
      const consumeResult = await client.query(
        `UPDATE otp_challenges
         SET consumed_at = $1, attempts_remaining = 0, updated_at = $1
         WHERE challenge_id = $2 AND consumed_at IS NULL`,
        [now, challengeId]
      );

      if (consumeResult.rowCount === 0) {
        throw new HttpException({ statusCode: 409, error: ErrorCodes.AUTH_OTP_CONSUMED.code }, 409);
      }

      const session = await this.sessionService.createSession(
        userId,
        false,
        {
          ip,
          ...(userAgent ? { userAgent } : {}),
          ...(deviceFingerprint ? { fingerprint: deviceFingerprint } : {}),
        },
        authVersion,
        client
      );

      await client.query(`UPDATE users SET last_login_at = NOW() WHERE user_id = $1`, [userId]);

      // 5. Optionally mark device as trusted
      const trustedIp = deviceTrustIp(ip);
      if (trustDevice && deviceFingerprint && trustedIp) {
        const trustNow = new Date();
        const trustExpiresAt = new Date(trustNow.getTime() + 30 * 24 * 60 * 60 * 1000);
        const trustId = uuidv7();

        const granted = await client.query(
          `INSERT INTO device_trusts (id, user_id, device_fingerprint, user_agent_hint, trusted_at, expires_at, ip_address)
           VALUES ($1, $2, $3, $4, $5, $6, $7::inet)
           ON CONFLICT (user_id, device_fingerprint) DO UPDATE
             SET user_agent_hint = $4, trusted_at = $5, expires_at = $6,
                 ip_address = $7::inet, updated_at = NOW()
           RETURNING id`,
          [
            trustId,
            userId,
            deviceFingerprint,
            userAgent ?? null,
            trustNow,
            trustExpiresAt,
            trustedIp,
          ]
        );
        await client.query(
          `INSERT INTO audit_log(id,user_id,event,metadata,correlation_id,ip,created_at)
           VALUES ($1,$2,'device_trust_granted',$3,$4,$5,clock_timestamp())`,
          [
            uuidv7(),
            userId,
            JSON.stringify({ deviceId: granted.rows[0].id }),
            correlationIdStorage.getStore() ?? uuidv7(),
            ip,
          ]
        );
      }

      // Session/trust writes can also wait. Roll back every effect if the
      // challenge expired before all authorization writes completed.
      const currentChallenge = await client.query(
        'SELECT expires_at>clock_timestamp() AS valid FROM otp_challenges WHERE challenge_id=$1',
        [challengeId]
      );
      if (!currentChallenge.rows[0]?.valid) {
        throw new HttpException({ statusCode: 401, error: ErrorCodes.AUTH_OTP_EXPIRED.code }, 401);
      }

      await client.query('COMMIT');

      const primaryUsername = challengeUserStatus.rows[0]?.username;
      if (primaryUsername)
        await this.rateLimitService
          .resetSecurityRateLimit(
            rateLimitKey(
              'login:failures',
              createHash('sha256')
                .update(JSON.stringify([primaryUsername.toLowerCase(), ip]))
                .digest('hex')
            )
          )
          .catch(() => {});

      this.logger.log(`Login OTP verified: user ${userId} from ${ip}`);

      return {
        userId,
        sessionId: session.sessionId,
        csrfToken: session.csrfToken,
        refreshToken: session.refreshToken,
        expiresAt: session.expiresAt.toISOString(),
      };
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
      if (err instanceof HttpException) throw err;
      this.logger.error(
        `Login OTP transaction failed for challenge ${challengeId}: ${String(err)}`
      );
      throw new HttpException({ statusCode: 500, error: ErrorCodes.AUTH_LOGIN_FAILED.code }, 500);
    } finally {
      client.release();
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
    userAgent?: string
  ): Promise<RegisterVerifyResponse> {
    const pool = getDbPool();
    const client = await pool.connect();
    let userId: string | undefined;

    try {
      await client.query('BEGIN');

      // 1. Lock and fetch the challenge row
      const challengeResult = await client.query(
        `SELECT challenge_id, destination, otp_hash, attempts_remaining,
                expires_at, consumed_at, password_hash, tos_version_id
         FROM otp_challenges
         WHERE challenge_id = $1 AND purpose = 'registration'
         FOR UPDATE`,
        [challengeId]
      );

      if (challengeResult.rows.length === 0) {
        throw new HttpException(
          { statusCode: 404, error: ErrorCodes.NOT_FOUND_RESOURCE.code },
          404
        );
      }

      const row = challengeResult.rows[0] as {
        destination: string;
        consumed_at: Date | null;
        expires_at: Date;
        attempts_remaining: number;
        password_hash: string | null;
        tos_version_id: string | null;
        otp_hash: string;
      };

      // Check consumed
      if (row.consumed_at) {
        throw new HttpException({ statusCode: 409, error: ErrorCodes.AUTH_OTP_CONSUMED.code }, 409);
      }

      // Check expiry
      if (new Date(row.expires_at) <= new Date()) {
        throw new HttpException({ statusCode: 401, error: ErrorCodes.AUTH_OTP_EXPIRED.code }, 401);
      }

      // Check attempts
      if (row.attempts_remaining <= 0) {
        throw new HttpException(
          { statusCode: 401, error: ErrorCodes.AUTH_OTP_MAX_ATTEMPTS.code },
          401
        );
      }

      // Check password_hash was stored (should always be present for registration)
      if (!row.password_hash || !row.tos_version_id) {
        this.logger.error(`Missing registration data for challenge ${challengeId}`);
        throw new HttpException(
          {
            statusCode: ErrorCodes.AUTH_REGISTER_FAILED.httpStatus,
            error: ErrorCodes.AUTH_REGISTER_FAILED.code,
          },
          ErrorCodes.AUTH_REGISTER_FAILED.httpStatus
        );
      }

      // 2. Verify OTP inside the transaction
      const submittedHash = this.otpService.hashOtp(otp);
      if (!this.otpService.compareOtpHashes(submittedHash, row.otp_hash)) {
        // Decrement attempts inside the transaction and commit
        await client.query(
          `UPDATE otp_challenges
           SET attempts_remaining = attempts_remaining - 1, updated_at = NOW()
           WHERE challenge_id = $1 AND attempts_remaining > 0`,
          [challengeId]
        );
        await client.query('COMMIT');

        throw new HttpException({ statusCode: 401, error: ErrorCodes.AUTH_OTP_INVALID.code }, 401);
      }

      // 3. Create user + consume OTP atomically (in transaction)
      userId = uuidv7();
      const now = new Date();

      // Consume the OTP challenge
      const consumeResult = await client.query(
        `UPDATE otp_challenges
         SET consumed_at = $1, attempts_remaining = 0, updated_at = $1
         WHERE challenge_id = $2 AND consumed_at IS NULL`,
        [now, challengeId]
      );

      if (consumeResult.rowCount === 0) {
        throw new HttpException({ statusCode: 409, error: ErrorCodes.AUTH_OTP_CONSUMED.code }, 409);
      }

      // Create user record
      await client.query(
        `INSERT INTO users (user_id, username, password_hash, locale,
                            last_accepted_tos_version, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $6)`,
        [userId, row.destination, row.password_hash, 'fa', row.tos_version_id, now]
      );

      // Pending invitations are discoverable by the verified username after
      // registration. Only the invitation acceptance endpoint grants membership.

      // 5. Record TOS acceptance immutably in tos_acceptances (T-04.01.02)
      // A newer publication must not change the terms this challenge accepted.
      const tosResult = await client.query<{ id: string; content_fa: string; content_en: string }>(
        `SELECT id,content_fa,content_en FROM tos_versions
         WHERE id::text=$1 AND status='published' AND published_at IS NOT NULL
         FOR SHARE`,
        [row.tos_version_id]
      );

      const tosVersionId = tosResult.rows[0]?.id ?? null;

      if (tosVersionId) {
        const acceptanceId = uuidv7();
        await client.query(
          `INSERT INTO tos_acceptances (id, user_id, version_id, accepted_at, ip_address, user_agent)
           VALUES ($1, $2, $3, $4, $5, $6)`,
          [acceptanceId, userId, tosVersionId, now, ip, userAgent ?? null]
        );
      } else {
        throw new HttpException(
          {
            statusCode: ErrorCodes.AUTH_REGISTER_TOS_NOT_ACCEPTED.httpStatus,
            error: ErrorCodes.AUTH_REGISTER_TOS_NOT_ACCEPTED.code,
          },
          ErrorCodes.AUTH_REGISTER_TOS_NOT_ACCEPTED.httpStatus
        );
      }

      const session = await this.sessionService.createSession(
        userId,
        false,
        { ip, ...(userAgent ? { userAgent } : {}) },
        undefined,
        client
      );

      // Keep the creation audit and the exact accepted publication hashes in
      // the same transaction as consent, OTP consumption and session creation.
      const acceptedTerms = tosResult.rows[0]!;
      await client.query(
        `INSERT INTO audit_log(id,user_id,event,metadata,correlation_id,ip,created_at)
         VALUES ($1,$2,'user_created',$3,$4,$5,clock_timestamp())`,
        [
          uuidv7(),
          userId,
          JSON.stringify({
            terms: {
              versionId: acceptedTerms.id,
              acceptedAt: now.toISOString(),
              hashAlgorithm: 'sha256',
              contentHashes: {
                fa: createHash('sha256').update(acceptedTerms.content_fa).digest('hex'),
                en: createHash('sha256').update(acceptedTerms.content_en).digest('hex'),
              },
            },
          }),
          correlationIdStorage.getStore() ?? uuidv7(),
          ip,
        ]
      );

      // Consent, session and audit writes can wait beyond the OTP deadline.
      // Check database wall time after all writes so expiry rolls everything back.
      const currentChallenge = await client.query(
        'SELECT expires_at>clock_timestamp() AS valid FROM otp_challenges WHERE challenge_id=$1',
        [challengeId]
      );
      if (!currentChallenge.rows[0]?.valid) {
        throw new HttpException({ statusCode: 401, error: ErrorCodes.AUTH_OTP_EXPIRED.code }, 401);
      }

      await client.query('COMMIT');

      this.logger.log(`User created: ${userId} (${row.destination}) from ${ip}`);

      return {
        userId,
        sessionId: session.sessionId,
        csrfToken: session.csrfToken,
        refreshToken: session.refreshToken,
        expiresAt: session.expiresAt.toISOString(),
      };
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
      if (err instanceof HttpException) throw err;
      this.logger.error(`Registration session creation failed for user ${userId}: ${String(err)}`);
      throw new HttpException(
        {
          statusCode: ErrorCodes.AUTH_REGISTER_FAILED.httpStatus,
          error: ErrorCodes.AUTH_REGISTER_FAILED.code,
        },
        ErrorCodes.AUTH_REGISTER_FAILED.httpStatus
      );
    } finally {
      client.release();
    }
  }

  private async enforceResetLimit(challengeId: string, phase: 'verify' | 'complete') {
    // Quotas survive transaction rollback and need no second checked-out connection.
    const result = await getDbPool().query(
      "SELECT destination FROM otp_challenges WHERE challenge_id=$1 AND purpose='password_reset'",
      [challengeId]
    );
    if (result.rows[0]) {
      await this.rateLimitService.enforceSecurityRateLimit(
        rateLimitKey(
          `password-reset:${phase}:destination`,
          createHash('sha256').update(result.rows[0].destination.toLowerCase()).digest('hex')
        ),
        5,
        3_600_000
      );
    }
  }

  private async assertResetDeadline(client: PoolClient, challengeId: string) {
    const result = await client.query(
      'SELECT expires_at>clock_timestamp() AS valid FROM otp_challenges WHERE challenge_id=$1',
      [challengeId]
    );
    if (!result.rows[0]?.valid) {
      throw new HttpException({ statusCode: 401, error: ErrorCodes.AUTH_OTP_EXPIRED.code }, 401);
    }
  }

  /** Caller owns the transaction, including failed-guess persistence. */
  private async authorizePasswordReset(
    client: PoolClient,
    input: VerifyResetOtpInput | ResetPasswordInput
  ) {
    const result = await client.query(
      `SELECT user_id,auth_version,otp_hash,attempts_remaining,expires_at,consumed_at,
              reset_token_hash,reset_consumed_at FROM otp_challenges
       WHERE challenge_id=$1 AND purpose='password_reset' FOR UPDATE`,
      [input.challengeId]
    );
    const row = result.rows[0];
    if (!row)
      throw new HttpException({ statusCode: 404, error: ErrorCodes.NOT_FOUND_RESOURCE.code }, 404);
    const isGrant = 'resetToken' in input;
    if (isGrant ? row.reset_consumed_at : row.consumed_at) {
      throw new HttpException({ statusCode: 409, error: ErrorCodes.AUTH_OTP_CONSUMED.code }, 409);
    }
    await this.assertResetDeadline(client, input.challengeId);
    if (!isGrant && row.attempts_remaining <= 0) {
      throw new HttpException(
        { statusCode: 401, error: ErrorCodes.AUTH_OTP_MAX_ATTEMPTS.code },
        401
      );
    }
    if (!row.user_id) {
      throw new HttpException(
        { statusCode: 400, error: ErrorCodes.VALIDATION_INPUT_INVALID.code },
        400
      );
    }
    const status = await client.query('SELECT disabled_at FROM users WHERE user_id=$1', [
      row.user_id,
    ]);
    if (status.rows[0]?.disabled_at) {
      throw new HttpException(
        { statusCode: 403, error: ErrorCodes.AUTH_ACCOUNT_DISABLED.code },
        403
      );
    }
    await this.otpService.assertCurrentAccount(row.user_id, row.auth_version, client);
    // The account is now locked. Replacement issuance only locks this account,
    // so it cannot race finalization or deadlock on an older challenge row.
    const account = await client.query(
      'SELECT password_reset_challenge_id FROM users WHERE user_id=$1',
      [row.user_id]
    );
    const currentId = account.rows[0]?.password_reset_challenge_id;
    // NULL admits pre-migration challenges until a new request replaces them.
    if (currentId && currentId !== input.challengeId) {
      throw new HttpException({ statusCode: 401, error: ErrorCodes.AUTH_TOKEN_INVALID.code }, 401);
    }
    await this.assertResetDeadline(client, input.challengeId);
    if ('resetToken' in input) {
      const submitted = createHash('sha256').update(input.resetToken).digest();
      const stored = Buffer.from(row.reset_token_hash ?? '', 'hex');
      if (
        !row.consumed_at ||
        stored.length !== submitted.length ||
        !timingSafeEqual(stored, submitted)
      ) {
        throw new HttpException(
          { statusCode: 401, error: ErrorCodes.AUTH_TOKEN_INVALID.code },
          401
        );
      }
      await client.query(
        'UPDATE otp_challenges SET reset_consumed_at=NOW(),updated_at=NOW() WHERE challenge_id=$1',
        [input.challengeId]
      );
    } else {
      if (!this.otpService.compareOtpHashes(this.otpService.hashOtp(input.otp), row.otp_hash)) {
        await client.query(
          'UPDATE otp_challenges SET attempts_remaining=attempts_remaining-1,updated_at=NOW() WHERE challenge_id=$1',
          [input.challengeId]
        );
        throw new OtpAttemptRejected();
      }
      await client.query(
        'UPDATE otp_challenges SET consumed_at=NOW(),attempts_remaining=0,updated_at=NOW() WHERE challenge_id=$1',
        [input.challengeId]
      );
    }
    return row;
  }

  async verifyResetOtp(input: VerifyResetOtpInput, ip: string): Promise<VerifyResetOtpResponse> {
    await this.enforceResetLimit(input.challengeId, 'verify');
    const client = await getDbPool().connect();
    try {
      await client.query('BEGIN');
      const row = await this.authorizePasswordReset(client, input);
      const resetToken = randomBytes(32).toString('hex');
      await client.query(
        'UPDATE otp_challenges SET reset_token_hash=$1,updated_at=NOW() WHERE challenge_id=$2',
        [createHash('sha256').update(resetToken).digest('hex'), input.challengeId]
      );
      await client.query(
        `INSERT INTO audit_log(id,user_id,event,metadata,correlation_id,ip)
         VALUES ($1,$2,'password_reset_verified',NULL,$3,$4)`,
        [uuidv7(), row.user_id, correlationIdStorage.getStore() ?? uuidv7(), ip]
      );
      await this.assertResetDeadline(client, input.challengeId);
      await client.query('COMMIT');
      return {
        verified: true,
        challengeId: input.challengeId,
        resetToken,
        expiresAt: new Date(row.expires_at).toISOString(),
      };
    } catch (error) {
      if (error instanceof OtpAttemptRejected) await client.query('COMMIT');
      else await client.query('ROLLBACK').catch(() => {});
      if (error instanceof HttpException) throw error;
      throw new HttpException({ statusCode: 500, error: ErrorCodes.INTERNAL_SERVER.code }, 500);
    } finally {
      client.release();
    }
  }

  /** Consume OTP or its reset grant; atomically change credentials and revoke every session. */
  async resetPassword(input: ResetPasswordInput, ip: string): Promise<ResetPasswordResponse> {
    if ('otp' in input) await this.enforceResetLimit(input.challengeId, 'verify');
    await this.enforceResetLimit(input.challengeId, 'complete');
    const client = await getDbPool().connect();
    try {
      await client.query('BEGIN');
      const row = await this.authorizePasswordReset(client, input);
      const now = new Date();
      const userId = row.user_id;

      // 4. Check password history (last 5 passwords)
      const historyResult = await client.query(
        `SELECT password_hash, version FROM password_history
         WHERE user_id = $1
         ORDER BY version DESC
         LIMIT 5`,
        [userId]
      );

      // Fetch current password hash
      const userResult = await client.query(
        `SELECT password_hash FROM users WHERE user_id = $1 FOR UPDATE`,
        [userId]
      );

      if (userResult.rows.length === 0) {
        throw new HttpException(
          { statusCode: 404, error: ErrorCodes.NOT_FOUND_RESOURCE.code },
          404
        );
      }

      const currentHash = userResult.rows[0].password_hash;
      const newHash = await argon2.hash(input.newPassword, PASSWORD_HASH_OPTIONS);

      // 4a. Check against current password
      const isSameAsCurrent = await argon2.verify(currentHash, input.newPassword);
      if (isSameAsCurrent) {
        await client.query('ROLLBACK');
        this.logger.warn(`Password reuse (same as current) detected for user ${userId} from ${ip}`);
        throw new HttpException(
          { statusCode: 422, error: ErrorCodes.AUTH_LOGIN_PASSWORD_REUSED.code },
          422
        );
      }

      // 4b. Check password history
      for (const entry of historyResult.rows) {
        const isReused = await argon2.verify(entry.password_hash, input.newPassword);
        if (isReused) {
          await client.query('ROLLBACK');
          this.logger.warn(`Password reuse detected for user ${userId} from ${ip}`);
          throw new HttpException(
            { statusCode: 422, error: ErrorCodes.AUTH_LOGIN_PASSWORD_REUSED.code },
            422
          );
        }
      }

      // 5. Record current password in history
      const version = historyResult.rows.length > 0 ? historyResult.rows[0].version + 1 : 1;

      const historyId = uuidv7();

      await client.query(
        `INSERT INTO password_history (id, user_id, password_hash, version, created_at)
         VALUES ($1, $2, $3, $4, $5)`,
        [historyId, userId, currentHash, version, now]
      );

      // 6. Update user's password hash
      await client.query(
        `UPDATE users
         SET password_hash = $1, updated_at = $2
         WHERE user_id = $3`,
        [newHash, now, userId]
      );

      // 7. Invalidate ALL existing sessions and refresh tokens
      await client.query(
        `UPDATE sessions
         SET revoked_at = $1, updated_at = $1
         WHERE user_id = $2 AND revoked_at IS NULL`,
        [now, userId]
      );

      await client.query(
        `UPDATE refresh_tokens
         SET consumed_at = $1
         WHERE user_id = $2 AND consumed_at IS NULL`,
        [now, userId]
      );

      // 8. Record audit event
      const auditId = uuidv7();
      const correlationId = correlationIdStorage.getStore() ?? uuidv7();

      await client.query(
        `INSERT INTO audit_log (id, user_id, event, metadata, correlation_id, ip, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [auditId, userId, 'password_reset', null, correlationId, ip, now]
      );

      // Credential revocation and audit writes can wait too. Expiry here
      // must roll back the OTP, password/history, sessions and audit together.
      await this.assertResetDeadline(client, input.challengeId);
      await client.query('COMMIT');

      this.logger.log(`Password reset for user ${userId} from ${ip}`);

      return {
        message: 'Your password has been reset. Please log in with your new password.',
      };
    } catch (err) {
      if (err instanceof OtpAttemptRejected) await client.query('COMMIT');
      else await client.query('ROLLBACK').catch(() => {});
      if (err instanceof HttpException) throw err;

      this.logger.error(`Password reset failed: ${String(err)}`);
      throw new HttpException({ statusCode: 500, error: ErrorCodes.INTERNAL_SERVER.code }, 500);
    } finally {
      client.release();
    }
  }

  // ── Username / Contact Change (T-03.03.04) ────────────────────────

  /**
   * Get current user info (username, email, mobile).
   */
  async getUser(userId: string): Promise<{
    userId: string;
    username: string;
    email: string | null;
    mobile: string | null;
    emailVerified: boolean;
    mobileVerified: boolean;
    requiresTosAcceptance: boolean;
  }> {
    const pool = getDbPool();

    const result = await pool.query(
      `SELECT user_id,username,email,mobile,
       EXISTS(SELECT 1 FROM account_login_identifiers i WHERE i.user_id=u.user_id AND i.destination=lower(u.email)) AS email_verified,
       EXISTS(SELECT 1 FROM account_login_identifiers i WHERE i.user_id=u.user_id AND i.destination=u.mobile) AS mobile_verified
       FROM users u WHERE user_id=$1`,
      [userId]
    );

    if (result.rows.length === 0) {
      throw new HttpException({ statusCode: 404, error: ErrorCodes.NOT_FOUND_RESOURCE.code }, 404);
    }

    const row = result.rows[0];

    // Check TOS re-acceptance status (T-04.01.03)
    const requiresTosAcceptance = await this.tosService.requiresReAcceptance(userId);

    return {
      userId: row.user_id,
      username: row.username,
      email: row.email ?? null,
      mobile: row.mobile ?? null,
      requiresTosAcceptance,
      emailVerified: row.email_verified === true,
      mobileVerified: row.mobile_verified === true,
    };
  }

  /**
   * Queue a linked OTP pair to the current and proposed usernames.
   *
   * Validates the new username is not the same as the current one and is
   * not already taken. Both challenges and delivery rows commit together.
   *
   * Rate limits are enforced via the controller's @RateLimit decorator.
   */
  async sendChangeUsernameOtp(
    userId: string,
    newUsername: string,
    ip: string,
    deviceToken?: string
  ): Promise<{ challengeId: string; destination: string; previousDestination: string }> {
    const pool = getDbPool();

    // 1. Fetch current user
    const userResult = await pool.query(
      `SELECT username, auth_version FROM users WHERE user_id = $1`,
      [userId]
    );

    if (userResult.rows.length === 0) {
      throw new HttpException({ statusCode: 404, error: ErrorCodes.NOT_FOUND_RESOURCE.code }, 404);
    }

    const currentUsername = userResult.rows[0].username;

    // 2. Check it's not the same
    if (currentUsername === newUsername) {
      throw new HttpException(
        { statusCode: 400, error: ErrorCodes.AUTH_CHANGE_USERNAME_SAME.code },
        400
      );
    }

    // 3. Check uniqueness
    const takenResult = await pool.query(
      `SELECT 1 FROM account_login_identifiers WHERE destination=$1 AND user_id<>$2 LIMIT 1`,
      [newUsername, userId]
    );

    if (takenResult.rows.length > 0) {
      throw new HttpException(
        { statusCode: 409, error: ErrorCodes.AUTH_CHANGE_USERNAME_TAKEN.code },
        409
      );
    }

    // Both codes and delivery rows are one issuance transaction.
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const binding = {
        purpose: 'change_username' as const,
        userId,
        authVersion: userResult.rows[0].auth_version,
      };
      const previous = await this.otpService.createChallenge(
        currentUsername,
        ip,
        undefined,
        undefined,
        binding,
        client,
        deviceToken
      );
      const next = await this.otpService.createChallenge(
        newUsername,
        ip,
        undefined,
        undefined,
        { ...binding, previousChallengeId: previous.challengeId },
        client,
        deviceToken
      );
      await client.query('COMMIT');
      return { ...next, previousDestination: currentUsername };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * Complete a username change after verifying both linked OTPs.
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
    previousOtp: string
  ): Promise<{ message: string }> {
    const pool = getDbPool();
    const client = await pool.connect();

    try {
      await client.query('BEGIN');

      // 1. Verify the challenge was created for this destination
      const challengeResult = await client.query(
        `SELECT destination, previous_challenge_id, consumed_at FROM otp_challenges
         WHERE challenge_id = $1 AND user_id = $2 AND purpose = $3
         FOR UPDATE`,
        [challengeId, userId, 'change_username']
      );

      if (challengeResult.rows.length === 0) {
        throw new HttpException(
          { statusCode: 404, error: ErrorCodes.NOT_FOUND_RESOURCE.code },
          404
        );
      }

      if (challengeResult.rows[0].consumed_at) {
        throw new HttpException({ statusCode: 409, error: ErrorCodes.AUTH_OTP_CONSUMED.code }, 409);
      }
      const challengeDestination = challengeResult.rows[0].destination;

      // Verify the challenge was created for the new username (operation scoping)
      if (challengeDestination !== newUsername) {
        this.logger.warn(
          `Challenge destination mismatch: challenge ${challengeId} was for ${challengeDestination} but request is for ${newUsername}`
        );
        throw new HttpException(
          { statusCode: 400, error: ErrorCodes.AUTH_CHANGE_USERNAME_INVALID.code },
          400
        );
      }

      const previousId = challengeResult.rows[0].previous_challenge_id;
      const previous = previousId
        ? await client.query(
            `SELECT c.destination FROM otp_challenges c JOIN users u ON u.user_id=c.user_id
         WHERE c.challenge_id=$1 AND c.user_id=$2 AND c.purpose='change_username'
           AND c.previous_challenge_id IS NULL AND c.destination=u.username
         FOR UPDATE OF c`,
            [previousId, userId]
          )
        : null;
      if (!previous?.rows.length) {
        throw new HttpException(
          { statusCode: 400, error: ErrorCodes.AUTH_CHANGE_USERNAME_INVALID.code },
          400
        );
      }
      // Validate both before consuming either. A wrong code commits only its
      // attempt decrement; a later account-write failure rolls everything back.
      await this.otpService.verifyChallenge(previousId, previousOtp, ip, client, false);
      await this.otpService.verifyChallenge(challengeId, otp, ip, client, false);
      await client.query(
        `UPDATE otp_challenges SET consumed_at=NOW(),attempts_remaining=0,updated_at=NOW()
        WHERE challenge_id=ANY($1::text[])`,
        [[previousId, challengeId]]
      );

      // 3. Re-check uniqueness inside the transaction
      const takenResult = await client.query(
        `SELECT 1 FROM account_login_identifiers WHERE destination=$1 AND user_id<>$2 LIMIT 1`,
        [newUsername, userId]
      );

      if (takenResult.rows.length > 0) {
        throw new HttpException(
          { statusCode: 409, error: ErrorCodes.AUTH_CHANGE_USERNAME_TAKEN.code },
          409
        );
      }

      // 3. Determine contact columns based on username type
      const emailRe = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      const isNewEmail = emailRe.test(newUsername);
      const userResult = await client.query(
        `SELECT username, email, mobile FROM users WHERE user_id = $1 FOR UPDATE`,
        [userId]
      );

      if (userResult.rows.length === 0) {
        throw new HttpException(
          { statusCode: 404, error: ErrorCodes.NOT_FOUND_RESOURCE.code },
          404
        );
      }

      const currentUser = userResult.rows[0];
      const now = new Date();

      // Update username and the corresponding contact column
      if (isNewEmail) {
        try {
          await client.query(
            `UPDATE users
             SET username = $1, email = $1, updated_at = $2
             WHERE user_id = $3`,
            [newUsername, now, userId]
          );
        } catch (err: unknown) {
          if (typeof err === 'object' && err !== null && 'code' in err && err.code === '23505') {
            // Unique constraint violation — another user claimed this username
            throw new HttpException(
              { statusCode: 409, error: ErrorCodes.AUTH_CHANGE_USERNAME_TAKEN.code },
              409
            );
          }
          throw err;
        }
      } else {
        // It's a mobile number
        try {
          await client.query(
            `UPDATE users
             SET username = $1, mobile = $1, updated_at = $2
             WHERE user_id = $3`,
            [newUsername, now, userId]
          );
        } catch (err: unknown) {
          if (typeof err === 'object' && err !== null && 'code' in err && err.code === '23505') {
            // Unique constraint violation — another user claimed this username
            throw new HttpException(
              { statusCode: 409, error: ErrorCodes.AUTH_CHANGE_USERNAME_TAKEN.code },
              409
            );
          }
          throw err;
        }
      }

      // 4. Invalidate all other sessions (keep current)
      await client.query(
        `UPDATE sessions
         SET revoked_at = $1, updated_at = $1
         WHERE user_id = $2 AND session_id != $3 AND revoked_at IS NULL`,
        [now, userId, currentSessionId]
      );

      // 5. Record audit event
      const auditId = uuidv7();
      const correlationId = uuidv7();
      await client.query(
        `INSERT INTO audit_log (id, user_id, event, metadata, correlation_id, ip, created_at)
         VALUES ($1, $2, $3, $4::jsonb, $5, $6, $7)`,
        [
          auditId,
          userId,
          'username_changed',
          JSON.stringify({ oldUsername: currentUser.username, newUsername }),
          correlationId,
          ip,
          now,
        ]
      );

      await client.query('COMMIT');

      this.logger.log(
        `Username changed: user ${userId} from ${ip} (${currentUser.username} → ${newUsername})`
      );

      return { message: 'Username changed successfully.' };
    } catch (err) {
      // Verification is the first mutation; retain its failed-attempt counter.
      await client.query(err instanceof OtpAttemptRejected ? 'COMMIT' : 'ROLLBACK');
      if (err instanceof HttpException) throw err;
      this.logger.error(`Username change failed for user ${userId}: ${String(err)}`);
      throw new HttpException({ statusCode: 500, error: ErrorCodes.INTERNAL_SERVER.code }, 500);
    } finally {
      client.release();
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
    deviceToken?: string
  ): Promise<{ challengeId: string; destination: string }> {
    const pool = getDbPool();

    // 1. Check current user's contact fields
    const userResult = await pool.query(
      `SELECT email,mobile,auth_version,
       EXISTS(SELECT 1 FROM account_login_identifiers i WHERE i.user_id=u.user_id AND i.destination=lower(u.email)) AS email_verified,
       EXISTS(SELECT 1 FROM account_login_identifiers i WHERE i.user_id=u.user_id AND i.destination=u.mobile) AS mobile_verified
       FROM users u WHERE user_id=$1`,
      [userId]
    );

    if (userResult.rows.length === 0) {
      throw new HttpException({ statusCode: 404, error: ErrorCodes.NOT_FOUND_RESOURCE.code }, 404);
    }

    const user = userResult.rows[0];

    // 2. Validate the user doesn't already have this contact type
    if (contactType === 'email' && user.email_verified) {
      throw new HttpException(
        { statusCode: 409, error: ErrorCodes.AUTH_CHANGE_USERNAME_ALREADY_HAS_EMAIL.code },
        409
      );
    }

    if (contactType === 'mobile' && user.mobile_verified) {
      throw new HttpException(
        { statusCode: 409, error: ErrorCodes.AUTH_CHANGE_USERNAME_ALREADY_HAS_MOBILE.code },
        409
      );
    }

    // 3. Validate the contact value is appropriate
    if (contactType === 'email') {
      const emailRe = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRe.test(contactValue)) {
        throw new HttpException(
          { statusCode: 400, error: ErrorCodes.AUTH_CHANGE_USERNAME_INVALID.code },
          400
        );
      }
    } else {
      // mobile — must be E.164
      const e164Re = /^\+[1-9]\d{6,14}$/;
      if (!e164Re.test(contactValue)) {
        throw new HttpException(
          { statusCode: 400, error: ErrorCodes.AUTH_CHANGE_USERNAME_INVALID.code },
          400
        );
      }
    }

    const taken = await pool.query(
      'SELECT 1 FROM account_login_identifiers WHERE destination=$1 AND user_id<>$2',
      [contactValue, userId]
    );
    if (taken.rows.length)
      throw new HttpException(
        { statusCode: 409, error: ErrorCodes.AUTH_CHANGE_USERNAME_TAKEN.code },
        409
      );

    // 4. Create OTP challenge
    return this.otpService.createChallenge(
      contactValue,
      ip,
      undefined,
      undefined,
      {
        purpose: contactType === 'email' ? 'add_email' : 'add_mobile',
        userId,
        authVersion: user.auth_version,
      },
      undefined,
      deviceToken
    );
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
    ip: string
  ): Promise<{ message: string }> {
    const pool = getDbPool();
    const client = await pool.connect();

    try {
      await client.query('BEGIN');

      // 1. Verify the challenge was created for this destination
      const challengeResult = await client.query(
        `SELECT destination,consumed_at FROM otp_challenges
         WHERE challenge_id = $1 AND user_id = $2 AND purpose = $3
         FOR UPDATE`,
        [challengeId, userId, contactType === 'email' ? 'add_email' : 'add_mobile']
      );

      if (challengeResult.rows.length === 0) {
        throw new HttpException(
          { statusCode: 404, error: ErrorCodes.NOT_FOUND_RESOURCE.code },
          404
        );
      }

      if (challengeResult.rows[0].consumed_at) {
        throw new HttpException({ statusCode: 409, error: ErrorCodes.AUTH_OTP_CONSUMED.code }, 409);
      }
      const challengeDestination = challengeResult.rows[0].destination;

      // Verify the challenge was created for the contact value (operation scoping)
      if (challengeDestination !== contactValue) {
        this.logger.warn(
          `Challenge destination mismatch: challenge ${challengeId} was for ${challengeDestination} but request is for ${contactValue}`
        );
        throw new HttpException(
          { statusCode: 400, error: ErrorCodes.AUTH_CHANGE_USERNAME_INVALID.code },
          400
        );
      }

      // 2. Verify OTP
      await this.otpService.verifyChallenge(challengeId, otp, ip, client);

      // 2. Re-check user doesn't already have this contact type
      const userResult = await client.query(
        `SELECT email,mobile,
       EXISTS(SELECT 1 FROM account_login_identifiers i WHERE i.user_id=u.user_id AND i.destination=lower(u.email)) AS email_verified,
       EXISTS(SELECT 1 FROM account_login_identifiers i WHERE i.user_id=u.user_id AND i.destination=u.mobile) AS mobile_verified
       FROM users u WHERE user_id=$1 FOR UPDATE`,
        [userId]
      );

      if (userResult.rows.length === 0) {
        throw new HttpException(
          { statusCode: 404, error: ErrorCodes.NOT_FOUND_RESOURCE.code },
          404
        );
      }

      const user = userResult.rows[0];

      if (contactType === 'email' && user.email_verified) {
        throw new HttpException(
          { statusCode: 409, error: ErrorCodes.AUTH_CHANGE_USERNAME_ALREADY_HAS_EMAIL.code },
          409
        );
      }

      if (contactType === 'mobile' && user.mobile_verified) {
        throw new HttpException(
          { statusCode: 409, error: ErrorCodes.AUTH_CHANGE_USERNAME_ALREADY_HAS_MOBILE.code },
          409
        );
      }

      // 3. Update the contact column
      const now = new Date();
      const column = contactType === 'email' ? 'email' : 'mobile';
      await client.query(`UPDATE users SET ${column} = $1, updated_at = $2 WHERE user_id = $3`, [
        contactValue,
        now,
        userId,
      ]);

      await client.query(
        'INSERT INTO account_login_identifiers(destination,user_id,kind,verified_at) VALUES ($1,$2,$3,NOW())',
        [contactValue, userId, contactType]
      );

      // 4. Record audit event
      const auditId = uuidv7();
      const correlationId = uuidv7();
      await client.query(
        `INSERT INTO audit_log (id, user_id, event, metadata, correlation_id, ip, created_at)
         VALUES ($1, $2, $3, $4::jsonb, $5, $6, $7)`,
        [
          auditId,
          userId,
          'contact_added',
          JSON.stringify({ contactType, contactValue }),
          correlationId,
          ip,
          now,
        ]
      );

      await client.query('COMMIT');

      this.logger.log(`Contact added: user ${userId} ${contactType}=${contactValue} from ${ip}`);

      return { message: 'Contact added successfully.' };
    } catch (err) {
      // Verification is the first mutation; retain its failed-attempt counter.
      await client.query(err instanceof OtpAttemptRejected ? 'COMMIT' : 'ROLLBACK');
      if (typeof err === 'object' && err !== null && 'code' in err && err.code === '23505')
        throw new HttpException(
          { statusCode: 409, error: ErrorCodes.AUTH_CHANGE_USERNAME_TAKEN.code },
          409
        );
      if (err instanceof HttpException) throw err;
      this.logger.error(`Add contact failed for user ${userId}: ${String(err)}`);
      throw new HttpException({ statusCode: 500, error: ErrorCodes.INTERNAL_SERVER.code }, 500);
    } finally {
      client.release();
    }
  }
}
