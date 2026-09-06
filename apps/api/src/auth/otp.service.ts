import { HttpException, Injectable, Logger } from '@nestjs/common';
import { randomInt, randomUUID, createHash, timingSafeEqual } from 'node:crypto';
import { getDbPool } from '@barghsa/db';
import { ErrorCodes } from '@barghsa/shared/errors';
import { encryptAuthDelivery } from '@barghsa/shared/auth-delivery';
import type { PoolClient } from 'pg';
import { RateLimitService } from '../rate-limit/rate-limit.service.js';

export type OtpPurpose =
  'registration' | 'login' | 'password_reset' | 'change_username' | 'add_email' | 'add_mobile';

export interface OtpChallengeResult {
  challengeId: string;
  destination: string;
}

/** The caller must commit the failed attempt before returning this rejection. */
export class OtpAttemptRejected extends HttpException {
  constructor() {
    super({ statusCode: 401, error: ErrorCodes.AUTH_OTP_INVALID.code }, 401);
  }
}

@Injectable()
export class OtpService {
  private readonly logger = new Logger(OtpService.name);

  static readonly OTP_TTL_MS = 5 * 60 * 1000;
  static readonly MAX_ATTEMPTS = 5;

  constructor(private readonly rateLimitService: RateLimitService) {}

  public generateOtp(): string {
    return String(randomInt(100_000, 1_000_000));
  }

  public hashOtp(otp: string): string {
    return createHash('sha256').update(otp).digest('hex');
  }

  public compareOtpHashes(hashedInput: string, storedHash: string): boolean {
    try {
      const inputBuf = Buffer.from(hashedInput, 'hex');
      const storedBuf = Buffer.from(storedHash, 'hex');
      return inputBuf.length === storedBuf.length && timingSafeEqual(inputBuf, storedBuf);
    } catch {
      return false;
    }
  }

  private static throwRateLimited(retryAfterMs: number): never {
    throw new HttpException(
      { statusCode: 429, error: ErrorCodes.AUTH_OTP_RATE_LIMITED.code, retryAfterMs },
      429
    );
  }

  async createChallenge(
    destination: string,
    ip: string,
    passwordHash?: string,
    tosVersionId?: string,
    binding:
      | {
          purpose: 'change_username' | 'add_email' | 'add_mobile';
          userId: string;
          authVersion?: number;
          previousChallengeId?: string;
        }
      | undefined = undefined,
    transactionClient?: Pick<PoolClient, 'query'>
  ): Promise<OtpChallengeResult> {
    await this.enforceSendRateLimits(destination, ip);

    const otp = this.generateOtp();
    const otpHash = this.hashOtp(otp);
    const challengeId = randomUUID();
    const expiresAt = new Date(Date.now() + OtpService.OTP_TTL_MS);

    const deliveryId = randomUUID();
    const encrypted = this.deliveryPayload(deliveryId, { code: otp, destination });
    const pool = transactionClient ?? getDbPool();
    await pool.query(
      `WITH challenge AS (
         INSERT INTO otp_challenges (challenge_id, destination, otp_hash, password_hash, tos_version_id, attempts_remaining, expires_at, purpose, user_id, auth_version, previous_challenge_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $12, $13) RETURNING challenge_id
       ) INSERT INTO auth_delivery_outbox(id,challenge_id,code_hash,encrypted_payload,expires_at)
         SELECT $10,challenge_id,$3,$11,$7 FROM challenge`,
      [
        challengeId,
        destination,
        otpHash,
        passwordHash ?? null,
        tosVersionId ?? null,
        OtpService.MAX_ATTEMPTS,
        expiresAt,
        binding?.purpose ?? 'registration',
        binding?.userId ?? null,
        deliveryId,
        encrypted,
        binding?.authVersion ?? null,
        binding?.previousChallengeId ?? null,
      ]
    );

    // Gate OTP debug logging behind NODE_ENV to prevent accidental prod exposure
    if (process.env.NODE_ENV === 'development') {
      this.logger.debug(`[DEV] OTP for ${destination}: ${otp}`);
    }
    this.logger.debug(`OTP challenge created for ${destination} (${challengeId})`);

    return { challengeId, destination };
  }

  /**
   * Create an OTP challenge for a login step-up flow (T-02.01.03).
   *
   * Links the challenge to an existing user (already authenticated via password)
   * so the verify step knows which user's session to create.
   *
   * Rate limits are the same as registration OTP (enforced via enforceSendRateLimits).
   */
  async createLoginChallenge(
    userId: string,
    destination: string,
    ip: string,
    purpose: 'login' | 'password_reset' = 'login',
    authVersion?: number
  ): Promise<OtpChallengeResult> {
    await this.enforceSendRateLimits(destination, ip);
    return this.createAccountChallenge(userId, destination, purpose, authVersion);
  }

  /** Apply identical quotas and return an opaque ID for both existing and unknown accounts. */
  async createPasswordResetChallenge(
    destination: string,
    ip: string
  ): Promise<{ challengeId: string }> {
    await this.enforceSendRateLimits(destination, ip);
    // Configuration failure must not reveal whether this destination has an account.
    this.deliveryPayload(randomUUID(), { code: '000000', destination });
    const found = await getDbPool().query<{ user_id: string; auth_version: number }>(
      'SELECT user_id,auth_version FROM users WHERE username=$1',
      [destination]
    );
    const user = found.rows[0];
    if (!user) return { challengeId: randomUUID() };
    return this.createAccountChallenge(
      user.user_id,
      destination,
      'password_reset',
      user.auth_version
    );
  }

  private async createAccountChallenge(
    userId: string,
    destination: string,
    purpose: 'login' | 'password_reset',
    authVersion?: number
  ): Promise<OtpChallengeResult> {
    const otp = this.generateOtp();
    const otpHash = this.hashOtp(otp);
    const challengeId = randomUUID();
    const expiresAt = new Date(Date.now() + OtpService.OTP_TTL_MS);

    const deliveryId = randomUUID();
    const encrypted = this.deliveryPayload(deliveryId, { code: otp, destination });
    const pool = getDbPool();
    await pool.query(
      `WITH challenge AS (
         INSERT INTO otp_challenges (challenge_id, destination, otp_hash, user_id, attempts_remaining, expires_at, purpose, auth_version)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $10) RETURNING challenge_id
       ) INSERT INTO auth_delivery_outbox(id,challenge_id,code_hash,encrypted_payload,expires_at)
         SELECT $8,challenge_id,$3,$9,$6 FROM challenge`,
      [
        challengeId,
        destination,
        otpHash,
        userId,
        OtpService.MAX_ATTEMPTS,
        expiresAt,
        purpose,
        deliveryId,
        encrypted,
        authVersion ?? null,
      ]
    );

    // Gate OTP debug logging behind NODE_ENV to prevent accidental prod exposure
    if (process.env.NODE_ENV === 'development') {
      this.logger.debug(`[DEV] OTP for ${destination}: ${otp}`);
    }
    this.logger.debug(`OTP login challenge created for user ${userId} (${challengeId})`);

    return { challengeId, destination };
  }

  async resendChallenge(
    challengeId: string,
    ip: string,
    purpose: OtpPurpose
  ): Promise<{ challengeId: string }> {
    const pool = getDbPool();

    const result = await pool.query(
      `SELECT challenge_id, destination, consumed_at, expires_at, resend_count, otp_hash, attempts_remaining
       FROM otp_challenges
       WHERE challenge_id = $1 AND purpose = $2`,
      [challengeId, purpose]
    );

    if (result.rows.length === 0) {
      throw new HttpException({ statusCode: 404, error: ErrorCodes.NOT_FOUND_RESOURCE.code }, 404);
    }

    const { destination, consumed_at, expires_at, otp_hash, attempts_remaining } = result.rows[0];

    if (consumed_at) {
      throw new HttpException({ statusCode: 409, error: ErrorCodes.AUTH_OTP_CONSUMED.code }, 409);
    }

    if (new Date(expires_at) < new Date()) {
      throw new HttpException({ statusCode: 401, error: ErrorCodes.AUTH_OTP_EXPIRED.code }, 401);
    }

    if (attempts_remaining <= 0) {
      throw new HttpException(
        { statusCode: 401, error: ErrorCodes.AUTH_OTP_MAX_ATTEMPTS.code },
        401
      );
    }

    const perChallenge = await this.rateLimitService.checkSecurityRateLimit(
      `otp:resend:${challengeId}:3600s`,
      3,
      3_600_000
    );
    if (!perChallenge.allowed) {
      OtpService.throwRateLimited(perChallenge.resetMs);
    }

    await this.enforceSendRateLimits(destination, ip);

    const otp = this.generateOtp();
    const otpHash = this.hashOtp(otp);
    const newExpiresAt = new Date(Date.now() + OtpService.OTP_TTL_MS);

    // NOTE: Intentionally do NOT reset attempts_remaining on resend —
    // prevents brute-force bypass via resend cycling (new OTP, same attempts budget)
    const deliveryId = randomUUID();
    const encrypted = this.deliveryPayload(deliveryId, { code: otp, destination });
    const updated = await pool.query(
      `WITH challenge AS (UPDATE otp_challenges
       SET otp_hash = $1, expires_at = $2, resend_count = resend_count + 1, updated_at = NOW()
       WHERE challenge_id = $3 AND otp_hash = $4 AND consumed_at IS NULL
         AND expires_at > NOW() AND attempts_remaining > 0 RETURNING challenge_id)
       INSERT INTO auth_delivery_outbox(id,challenge_id,code_hash,encrypted_payload,expires_at)
       SELECT $5,challenge_id,$1,$6,$2 FROM challenge`,
      [otpHash, newExpiresAt, challengeId, otp_hash, deliveryId, encrypted]
    );
    if (updated.rowCount === 0) {
      throw new HttpException({ statusCode: 409, error: ErrorCodes.AUTH_OTP_CONSUMED.code }, 409);
    }

    // Gate OTP debug logging behind NODE_ENV to prevent accidental prod exposure
    if (process.env.NODE_ENV === 'development') {
      this.logger.debug(`[DEV] OTP for ${destination}: ${otp}`);
    }
    this.logger.debug(`OTP resend for ${destination} (${challengeId})`);

    return { challengeId };
  }

  async verifyChallenge(
    challengeId: string,
    otp: string,
    _ip: string,
    client: Pick<PoolClient, 'query'>,
    consume = true
  ): Promise<{ verified: true; challengeId: string }> {
    // Use the caller transaction so consumption and the account change commit together.

    const result = await client.query(
      `SELECT challenge_id, destination, otp_hash, attempts_remaining, expires_at, consumed_at, user_id, auth_version
       FROM otp_challenges
       WHERE challenge_id = $1 FOR UPDATE`,
      [challengeId]
    );

    if (result.rows.length === 0) {
      throw new HttpException({ statusCode: 404, error: ErrorCodes.NOT_FOUND_RESOURCE.code }, 404);
    }

    const row = result.rows[0];

    if (row.consumed_at) {
      throw new HttpException({ statusCode: 409, error: ErrorCodes.AUTH_OTP_CONSUMED.code }, 409);
    }

    if (new Date(row.expires_at) < new Date()) {
      throw new HttpException({ statusCode: 401, error: ErrorCodes.AUTH_OTP_EXPIRED.code }, 401);
    }

    if (row.attempts_remaining <= 0) {
      throw new HttpException(
        { statusCode: 401, error: ErrorCodes.AUTH_OTP_MAX_ATTEMPTS.code },
        401
      );
    }

    if (row.user_id) await this.assertCurrentAccount(row.user_id, row.auth_version, client);

    const submittedHash = this.hashOtp(otp);
    if (!this.compareOtpHashes(submittedHash, row.otp_hash)) {
      await client.query(
        `UPDATE otp_challenges
         SET attempts_remaining = attempts_remaining - 1, updated_at = NOW()
         WHERE challenge_id = $1 AND attempts_remaining > 0`,
        [challengeId]
      );

      throw new OtpAttemptRejected();
    }

    if (!consume) return { verified: true, challengeId };

    const consumeResult = await client.query(
      `UPDATE otp_challenges
       SET consumed_at = NOW(), attempts_remaining = 0, updated_at = NOW()
       WHERE challenge_id = $1 AND consumed_at IS NULL`,
      [challengeId]
    );

    if (consumeResult.rowCount === 0) {
      throw new HttpException({ statusCode: 409, error: ErrorCodes.AUTH_OTP_CONSUMED.code }, 409);
    }

    this.logger.debug(`OTP verified for challenge ${challengeId}`);

    return { verified: true, challengeId };
  }

  /** The caller holds this account lock until its authentication change commits. */
  async assertCurrentAccount(
    userId: string,
    version: unknown,
    client: Pick<PoolClient, 'query'>
  ): Promise<void> {
    const account = await client.query(
      'SELECT auth_version,disabled_at FROM users WHERE user_id=$1 FOR UPDATE',
      [userId]
    );
    if (
      !Number.isInteger(version) ||
      account.rows[0]?.auth_version !== version ||
      account.rows[0]?.disabled_at
    ) {
      throw new HttpException({ statusCode: 401, error: ErrorCodes.AUTH_TOKEN_INVALID.code }, 401);
    }
  }

  private deliveryPayload(id: string, payload: { code: string; destination: string }): string {
    try {
      return encryptAuthDelivery(id, payload);
    } catch {
      throw new HttpException(
        { statusCode: 503, error: ErrorCodes.AUTH_DELIVERY_UNAVAILABLE.code },
        503
      );
    }
  }

  private async enforceSendRateLimits(destination: string, ip: string): Promise<void> {
    const perMinute = await this.rateLimitService.checkSecurityRateLimit(
      `otp:dest:${destination}:60s`,
      1,
      60_000
    );
    if (!perMinute.allowed) {
      OtpService.throwRateLimited(perMinute.resetMs);
    }

    const perHour = await this.rateLimitService.checkSecurityRateLimit(
      `otp:dest:${destination}:3600s`,
      5,
      3_600_000
    );
    if (!perHour.allowed) {
      OtpService.throwRateLimited(perHour.resetMs);
    }

    const perDay = await this.rateLimitService.checkSecurityRateLimit(
      `otp:dest:${destination}:86400s`,
      10,
      86_400_000
    );
    if (!perDay.allowed) {
      OtpService.throwRateLimited(perDay.resetMs);
    }

    const ipLimit = await this.rateLimitService.checkSecurityRateLimit(
      `otp:ip:${ip}:3600s`,
      20,
      3_600_000
    );
    if (!ipLimit.allowed) {
      OtpService.throwRateLimited(ipLimit.resetMs);
    }
  }
}
