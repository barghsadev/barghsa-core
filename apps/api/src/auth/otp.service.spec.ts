import { describe, it, expect, vi, beforeEach } from 'vitest'
import { HttpException } from '@nestjs/common'
import { OtpService } from './otp.service.js'
import { ErrorCodes } from '@barghsa/shared/errors'

// ── Mock dependencies ──────────────────────────────────────────────
const mockRateLimitService = {
  checkSecurityRateLimit: vi.fn(),
}

const mockPool = {
  query: vi.fn(),
}

vi.mock('@barghsa/db', () => ({
  getDbPool: () => mockPool,
}))

describe('OtpService', () => {
  let service: OtpService

  beforeEach(() => {
    vi.clearAllMocks()

    // By default, all rate limits pass
    mockRateLimitService.checkSecurityRateLimit.mockResolvedValue({ allowed: true })
    mockPool.query.mockResolvedValue({ rows: [] })

    service = new OtpService(mockRateLimitService as any)
  })

  describe('createChallenge', () => {
    const destination = '+989****4567'
    const ip = '192.168.1.1'

    it('creates an OTP challenge successfully', async () => {
      const result = await service.createChallenge(destination, ip)

      expect(result).toHaveProperty('challengeId')
      expect(result).toHaveProperty('destination', destination)
      expect(result.challengeId).toBeTruthy()
      expect(typeof result.challengeId).toBe('string')

      // Verify all four rate limit checks were made
      expect(mockRateLimitService.checkSecurityRateLimit).toHaveBeenCalledTimes(4)

      // Verify DB insert was called
      expect(mockPool.query).toHaveBeenCalledTimes(1)
      const [sql, params] = mockPool.query.mock.calls[0]
      expect(sql).toContain('INSERT INTO otp_challenges')
      expect(params[1]).toBe(destination) // destination in params
      expect(typeof params[0]).toBe('string') // challengeId is a UUID
      expect(typeof params[2]).toBe('string') // otp_hash is a hex string
      expect(params[3]).toBe(OtpService.MAX_ATTEMPTS) // attempts_remaining
      expect(params[4]).toBeInstanceOf(Date) // expires_at
    })

    it('throws rate-limited when per-minute limit is hit', async () => {
      mockRateLimitService.checkSecurityRateLimit
        .mockReset()
        .mockResolvedValue({ allowed: false })

      try {
        await service.createChallenge(destination, ip)
        // Should not reach here — rate-limited
        expect(true).toBe(false)
      } catch (err) {
        expect(err).toBeInstanceOf(HttpException)
        expect((err as HttpException).getResponse()).toHaveProperty('error', ErrorCodes.AUTH_OTP_RATE_LIMITED.code)
        expect((err as HttpException).getStatus()).toBe(429)
      }
    })

    it('throws rate-limited when IP aggregate limit is hit', async () => {
      // First three pass, fourth (IP) fails
      mockRateLimitService.checkSecurityRateLimit
        .mockReset()
        .mockResolvedValueOnce({ allowed: true })  // 60s
        .mockResolvedValueOnce({ allowed: true })  // 3600s
        .mockResolvedValueOnce({ allowed: true })  // 86400s
        .mockResolvedValueOnce({ allowed: false }) // IP

      try {
        await service.createChallenge(destination, ip)
        expect(true).toBe(false)
      } catch (err) {
        expect(err).toBeInstanceOf(HttpException)
      }
    })

    it('generates a 6-digit OTP', () => {
      // Access private method via prototype for testing
      const otp = (OtpService.prototype as any).generateOtp()
      expect(otp).toMatch(/^\d{6}$/)
      const num = parseInt(otp, 10)
      expect(num).toBeGreaterThanOrEqual(100_000)
      expect(num).toBeLessThan(1_000_000)
    })

    it('produces a SHA-256 hex hash', () => {
      const hash = (OtpService.prototype as any).hashOtp('123456')
      expect(hash).toMatch(/^[a-f0-9]{64}$/) // SHA-256 hex length
    })
  })

  describe('verifyChallenge', () => {
    const challengeId = '0000-000-00000'
    const destination = 'user@example.com'

    beforeEach(() => {
      mockPool.query.mockResolvedValue({
        rows: [{
          challenge_id: challengeId,
          destination,
          otp_hash: (OtpService.prototype as any).hashOtp('123456'),
          attempts_remaining: 5,
          expires_at: new Date(Date.now() + 60_000), // not expired
          consumed_at: null,
        }],
      })
    })

    it('verifies a correct OTP', async () => {
      const result = await service.verifyChallenge(challengeId, '123456', '127.0.0.1')

      expect(result).toEqual({ verified: true, challengeId })

      // Should have consumed the challenge
      const lastCall = mockPool.query.mock.calls[mockPool.query.mock.calls.length - 1]
      expect(lastCall[0]).toContain('consumed_at')
    })

    it('rejects an incorrect OTP and decrements attempts', async () => {
      await expect(
        service.verifyChallenge(challengeId, '654321', '127.0.0.1'),
      ).rejects.toThrow(HttpException)

      // Should have decremented attempts
      const updateCall = mockPool.query.mock.calls.find(
        (c: any) => (c[0] as string).includes('attempts_remaining = attempts_remaining - 1'),
      )
      expect(updateCall).toBeTruthy()
    })

    it('rejects a consumed challenge', async () => {
      mockPool.query.mockResolvedValue({
        rows: [{
          challenge_id: challengeId,
          destination,
          otp_hash: 'abc',
          attempts_remaining: 0,
          expires_at: new Date(Date.now() + 60_000),
          consumed_at: new Date(), // consumed!
        }],
      })

      await expect(
        service.verifyChallenge(challengeId, '123456', '127.0.0.1'),
      ).rejects.toThrow(HttpException)
    })

    it('rejects an expired challenge', async () => {
      mockPool.query.mockResolvedValue({
        rows: [{
          challenge_id: challengeId,
          destination,
          otp_hash: 'abc',
          attempts_remaining: 5,
          expires_at: new Date(Date.now() - 60_000), // expired!
          consumed_at: null,
        }],
      })

      await expect(
        service.verifyChallenge(challengeId, '123456', '127.0.0.1'),
      ).rejects.toThrow(HttpException)
    })

    it('rejects when no attempts remaining', async () => {
      mockPool.query.mockResolvedValue({
        rows: [{
          challenge_id: challengeId,
          destination,
          otp_hash: 'abc',
          attempts_remaining: 0,
          expires_at: new Date(Date.now() + 60_000),
          consumed_at: null,
        }],
      })

      await expect(
        service.verifyChallenge(challengeId, '123456', '127.0.0.1'),
      ).rejects.toThrow(HttpException)
    })
  })

  describe('resendChallenge', () => {
    const challengeId = '0000-000-00000'
    const destination = 'user@example.com'

    beforeEach(() => {
      mockPool.query.mockResolvedValueOnce({
        rows: [{
          challenge_id: challengeId,
          destination,
          consumed_at: null,
          expires_at: new Date(Date.now() + 60_000),
          resend_count: 0,
        }],
      })
    })

    it('resends successfully', async () => {
      const result = await service.resendChallenge(challengeId, '127.0.0.1')

      expect(result).toEqual({ challengeId })

      // Should have done SELECT + UPDATE
      expect(mockPool.query).toHaveBeenCalledTimes(2)
      const updateSql = mockPool.query.mock.calls[1][0] as string
      expect(updateSql).toContain('UPDATE otp_challenges')
      expect(updateSql).toContain('otp_hash')
    })
  })
})