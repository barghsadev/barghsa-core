import { HttpException, Injectable, Logger } from '@nestjs/common'
import { randomInt, randomUUID, createHash, timingSafeEqual } from 'node:crypto'
import { getDbPool } from '@barghsa/db'
import { ErrorCodes } from '@barghsa/shared/errors'
import { RateLimitService } from '../rate-limit/rate-limit.service.js'

export interface OtpChallengeResult {
  challengeId: string
  destination: string
}

@Injectable()
export class OtpService {
  private readonly logger = new Logger(OtpService.name)

  static readonly OTP_TTL_MS = 5 * 60 * 1000
  static readonly MAX_ATTEMPTS = 5

  constructor(private readonly rateLimitService: RateLimitService) {}

  private generateOtp(): string {
    return String(randomInt(100_000, 1_000_000))
  }

  private hashOtp(otp: string): string {
    return createHash('sha256').update(otp).digest('hex')
  }

  private compareOtpHashes(hashedInput: string, storedHash: string): boolean {
    try {
      const inputBuf = Buffer.from(hashedInput, 'hex')
      const storedBuf = Buffer.from(storedHash, 'hex')
      return inputBuf.length === storedBuf.length && timingSafeEqual(inputBuf, storedBuf)
    } catch {
      return false
    }
  }

  private static throwRateLimited(): never {
    throw new HttpException(
      { statusCode: 429, error: ErrorCodes.AUTH_OTP_RATE_LIMITED.code },
      429,
    )
  }

  async createChallenge(
    destination: string,
    ip: string,
  ): Promise<OtpChallengeResult> {
    await this.enforceSendRateLimits(destination, ip)

    const otp = this.generateOtp()
    const otpHash = this.hashOtp(otp)
    const challengeId = randomUUID()
    const expiresAt = new Date(Date.now() + OtpService.OTP_TTL_MS)

    const pool = getDbPool()
    await pool.query(
      `INSERT INTO otp_challenges (challenge_id, destination, otp_hash, attempts_remaining, expires_at)
       VALUES ($1, $2, $3, $4, $5)`,
      [challengeId, destination, otpHash, OtpService.MAX_ATTEMPTS, expiresAt],
    )

    this.logger.debug(`OTP challenge created for ${destination} (${challengeId})`)

    return { challengeId, destination }
  }

  async resendChallenge(
    challengeId: string,
    ip: string,
  ): Promise<{ challengeId: string }> {
    const pool = getDbPool()

    const result = await pool.query(
      `SELECT challenge_id, destination, consumed_at, expires_at, resend_count
       FROM otp_challenges
       WHERE challenge_id = $1`,
      [challengeId],
    )

    if (result.rows.length === 0) {
      throw new HttpException(
        { statusCode: 404, error: ErrorCodes.NOT_FOUND_RESOURCE.code },
        404,
      )
    }

    const { destination, consumed_at, expires_at, resend_count } = result.rows[0]

    if (consumed_at) {
      throw new HttpException(
        { statusCode: 409, error: ErrorCodes.AUTH_OTP_CONSUMED.code },
        409,
      )
    }

    if (new Date(expires_at) < new Date()) {
      throw new HttpException(
        { statusCode: 401, error: ErrorCodes.AUTH_OTP_EXPIRED.code },
        401,
      )
    }

    const perChallenge = await this.rateLimitService.checkSecurityRateLimit(
      `otp:resend:${challengeId}:3600s`,
      3,
      3_600_000,
    )
    if (!perChallenge.allowed) {
      OtpService.throwRateLimited()
    }

    await this.enforceSendRateLimits(destination, ip)

    const otp = this.generateOtp()
    const otpHash = this.hashOtp(otp)
    const newExpiresAt = new Date(Date.now() + OtpService.OTP_TTL_MS)

    await pool.query(
      `UPDATE otp_challenges
       SET otp_hash = $1, expires_at = $2, resend_count = resend_count + 1
       WHERE challenge_id = $3`,
      [otpHash, newExpiresAt, challengeId],
    )

    this.logger.debug(`[DEV] OTP for ${destination}: ${otp}`)
    this.logger.debug(`OTP resend for ${destination} (${challengeId})`)

    return { challengeId }
  }

  async verifyChallenge(
    challengeId: string,
    otp: string,
    _ip: string,
  ): Promise<{ verified: true; challengeId: string }> {
    const pool = getDbPool()

    const result = await pool.query(
      `SELECT challenge_id, destination, otp_hash, attempts_remaining, expires_at, consumed_at
       FROM otp_challenges
       WHERE challenge_id = $1`,
      [challengeId],
    )

    if (result.rows.length === 0) {
      throw new HttpException(
        { statusCode: 404, error: ErrorCodes.NOT_FOUND_RESOURCE.code },
        404,
      )
    }

    const row = result.rows[0]

    if (row.consumed_at) {
      throw new HttpException(
        { statusCode: 409, error: ErrorCodes.AUTH_OTP_CONSUMED.code },
        409,
      )
    }

    if (new Date(row.expires_at) < new Date()) {
      throw new HttpException(
        { statusCode: 401, error: ErrorCodes.AUTH_OTP_EXPIRED.code },
        401,
      )
    }

    if (row.attempts_remaining <= 0) {
      throw new HttpException(
        { statusCode: 401, error: ErrorCodes.AUTH_OTP_MAX_ATTEMPTS.code },
        401,
      )
    }

    const submittedHash = this.hashOtp(otp)
    if (!this.compareOtpHashes(submittedHash, row.otp_hash)) {
      await pool.query(
        `UPDATE otp_challenges
         SET attempts_remaining = attempts_remaining - 1, updated_at = NOW()
         WHERE challenge_id = $1 AND attempts_remaining > 0`,
        [challengeId],
      )

      throw new HttpException(
        { statusCode: 401, error: ErrorCodes.AUTH_OTP_INVALID.code },
        401,
      )
    }

    const consumeResult = await pool.query(
      `UPDATE otp_challenges
       SET consumed_at = NOW(), attempts_remaining = 0, updated_at = NOW()
       WHERE challenge_id = $1 AND consumed_at IS NULL`,
      [challengeId],
    )

    if (consumeResult.rowCount === 0) {
      throw new HttpException(
        { statusCode: 409, error: ErrorCodes.AUTH_OTP_CONSUMED.code },
        409,
      )
    }

    this.logger.debug(`OTP verified for challenge ${challengeId}`)

    return { verified: true, challengeId }
  }

  private async enforceSendRateLimits(destination: string, ip: string): Promise<void> {
    const perMinute = await this.rateLimitService.checkSecurityRateLimit(
      `otp:dest:${destination}:60s`,
      1,
      60_000,
    )
    if (!perMinute.allowed) {
      OtpService.throwRateLimited()
    }

    const perHour = await this.rateLimitService.checkSecurityRateLimit(
      `otp:dest:${destination}:3600s`,
      5,
      3_600_000,
    )
    if (!perHour.allowed) {
      OtpService.throwRateLimited()
    }

    const perDay = await this.rateLimitService.checkSecurityRateLimit(
      `otp:dest:${destination}:86400s`,
      10,
      86_400_000,
    )
    if (!perDay.allowed) {
      OtpService.throwRateLimited()
    }

    const ipLimit = await this.rateLimitService.checkSecurityRateLimit(
      `otp:ip:${ip}:3600s`,
      20,
      3_600_000,
    )
    if (!ipLimit.allowed) {
      OtpService.throwRateLimited()
    }
  }
}
