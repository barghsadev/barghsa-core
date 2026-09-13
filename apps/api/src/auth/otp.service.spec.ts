import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { HttpException, Logger } from '@nestjs/common';
import { OtpService } from './otp.service.js';
import { ErrorCodes } from '@barghsa/shared/errors';

// Configuration persistence and issuance are covered together by OTP-config HTTP tests.
vi.mock('./otp-config.js', () => ({
  readOtpConfig: async () => ({ ttlSeconds: 300, version: 0 }),
}));

const mockRateLimitService = {
  checkSecurityRateLimit: vi.fn(),
};

const mockPool = {
  query: vi.fn(),
};

vi.mock('@barghsa/db', () => ({
  getDbPool: () => mockPool,
}));

describe('OtpService', () => {
  let service: OtpService;

  beforeEach(() => {
    vi.stubEnv('AUTH_DELIVERY_ENCRYPTION_KEY', 'unit-test-delivery-key-only');
    vi.clearAllMocks();
    mockRateLimitService.checkSecurityRateLimit.mockResolvedValue({ allowed: true });
    mockPool.query.mockResolvedValue({ rows: [], rowCount: 1 });
    service = new OtpService(mockRateLimitService as any);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  describe.each(['registration', 'login', 'resend'] as const)('%s console isolation', (flow) => {
    it.each([
      ['development', 'true', true],
      ['development', 'false', false],
      ['development', '', false],
      ['production', 'true', false],
      ['staging', 'true', false],
      ['test', 'true', false],
    ] as const)('%s / OTP_CONSOLE=%s', async (environment, enabled, prints) => {
      vi.stubEnv('NODE_ENV', environment);
      vi.stubEnv('OTP_CONSOLE', enabled);
      vi.spyOn(service, 'generateOtp').mockReturnValue('654321');
      const debug = vi.spyOn(Logger.prototype, 'debug').mockImplementation(() => undefined);
      const destination = 'development@example.test';
      let result: unknown;
      if (flow === 'registration') {
        result = await service.createChallenge(destination, '127.0.0.1');
      } else if (flow === 'login') {
        result = await service.createLoginChallenge('console-user', destination, '127.0.0.1');
      } else {
        mockPool.query.mockResolvedValueOnce({
          rows: [
            {
              challenge_id: 'console-challenge',
              destination,
              consumed_at: null,
              expires_at: new Date(Date.now() + 60_000),
              resend_count: 0,
            },
          ],
          rowCount: 1,
        });
        result = await service.resendChallenge('console-challenge', '127.0.0.1', 'registration');
      }
      expect(debug.mock.calls.some(([message]) => String(message).includes('654321'))).toBe(prints);
      expect(JSON.stringify(result)).not.toContain('654321');
      // Console delivery must retain the challenge and encrypted durable outbox.
      expect(
        mockPool.query.mock.calls.some(([sql]) => String(sql).includes('auth_delivery_outbox'))
      ).toBe(true);
    });
  });

  describe('createChallenge', () => {
    const destination = '+989****4567';
    const ip = '192.168.1.1';

    it('creates an OTP challenge successfully', async () => {
      const result = await service.createChallenge(destination, ip);

      expect(result).toHaveProperty('challengeId');
      expect(result).toHaveProperty('destination', destination);
      expect(typeof result.challengeId).toBe('string');
      expect(mockRateLimitService.checkSecurityRateLimit).toHaveBeenCalledTimes(4);
      expect(mockPool.query).toHaveBeenCalledTimes(1);
      const firstCall = mockPool.query.mock.calls[0]!;
      const sql = firstCall[0] as string;
      const params = firstCall[1] as unknown[];
      expect(sql).toContain('INSERT INTO otp_challenges');
      expect(params[1]).toBe(destination);
      expect(typeof params[0]).toBe('string');
      expect(typeof params[2]).toBe('string');
      expect(params[3]).toBeNull(); // password_hash (null when not provided)
      expect(params[4]).toBeNull(); // tos_version_id (null when not provided)
      expect(params[5]).toBe(OtpService.MAX_ATTEMPTS);
      expect(params[6]).toBeInstanceOf(Date);
    });

    it('throws rate-limited when per-minute limit is hit', async () => {
      mockRateLimitService.checkSecurityRateLimit.mockReset().mockResolvedValue({ allowed: false });

      try {
        await service.createChallenge(destination, ip);
        expect.unreachable();
      } catch (err) {
        const httpErr = err as HttpException;
        expect(httpErr.getResponse()).toHaveProperty(
          'error',
          ErrorCodes.AUTH_OTP_RATE_LIMITED.code
        );
        expect(httpErr.getStatus()).toBe(429);
      }
    });

    it('throws rate-limited when IP aggregate limit is hit', async () => {
      mockRateLimitService.checkSecurityRateLimit
        .mockReset()
        .mockResolvedValueOnce({ allowed: true })
        .mockResolvedValueOnce({ allowed: true })
        .mockResolvedValueOnce({ allowed: true })
        .mockResolvedValueOnce({ allowed: false });

      try {
        await service.createChallenge(destination, ip);
        expect.unreachable();
      } catch (err) {
        expect(err).toBeInstanceOf(HttpException);
      }
    });

    it('generates a 6-digit OTP', () => {
      const otp = (OtpService.prototype as any).generateOtp();
      expect(otp).toMatch(/^\d{6}$/);
      const num = parseInt(otp, 10);
      expect(num).toBeGreaterThanOrEqual(100_000);
      expect(num).toBeLessThan(1_000_000);
    });

    it('produces a SHA-256 hex hash', () => {
      const hash = (OtpService.prototype as any).hashOtp('123456');
      expect(hash).toMatch(/^[a-f0-9]{64}$/);
    });
  });

  describe('verifyChallenge', () => {
    const challengeId = '00000000-0000-0000-0000-000000000000';
    const destination = 'user@example.com';

    beforeEach(() => {
      mockPool.query.mockResolvedValue({
        rows: [
          {
            challenge_id: challengeId,
            destination,
            otp_hash: (OtpService.prototype as any).hashOtp('123456'),
            attempts_remaining: 5,
            expires_at: new Date(Date.now() + 60_000),
            consumed_at: null,
          },
        ],
        rowCount: 1,
      });
    });

    it('verifies a correct OTP', async () => {
      const result = await service.verifyChallenge(challengeId, '123456', '127.0.0.1', mockPool);
      expect(result).toEqual({ verified: true, challengeId });

      const calls = mockPool.query.mock.calls;
      expect(calls).toHaveLength(2);
      const consumeSql = calls[1]![0] as string;
      expect(consumeSql).toContain('consumed_at IS NULL');
    });

    it('rejects an incorrect OTP and decrements attempts', async () => {
      await expect(
        service.verifyChallenge(challengeId, '654321', '127.0.0.1', mockPool)
      ).rejects.toThrow(HttpException);

      const calls = mockPool.query.mock.calls;
      const decCall = calls.find((c) =>
        (c![0] as string).includes('attempts_remaining = attempts_remaining - 1')
      );
      expect(decCall).toBeDefined();
      expect(decCall![0] as string).toContain('attempts_remaining > 0');
    });

    it('rejects a consumed challenge', async () => {
      mockPool.query.mockResolvedValue({
        rows: [
          {
            challenge_id: challengeId,
            destination,
            otp_hash: 'abc',
            attempts_remaining: 0,
            expires_at: new Date(Date.now() + 60_000),
            consumed_at: new Date(),
          },
        ],
        rowCount: 1,
      });

      await expect(
        service.verifyChallenge(challengeId, '123456', '127.0.0.1', mockPool)
      ).rejects.toThrow(HttpException);
    });

    it('rejects an expired challenge', async () => {
      mockPool.query.mockResolvedValue({
        rows: [
          {
            challenge_id: challengeId,
            destination,
            otp_hash: 'abc',
            attempts_remaining: 5,
            expires_at: new Date(Date.now() - 60_000),
            consumed_at: null,
          },
        ],
        rowCount: 1,
      });

      await expect(
        service.verifyChallenge(challengeId, '123456', '127.0.0.1', mockPool)
      ).rejects.toThrow(HttpException);
    });

    it('rejects when no attempts remaining', async () => {
      mockPool.query.mockResolvedValue({
        rows: [
          {
            challenge_id: challengeId,
            destination,
            otp_hash: 'abc',
            attempts_remaining: 0,
            expires_at: new Date(Date.now() + 60_000),
            consumed_at: null,
          },
        ],
        rowCount: 1,
      });

      await expect(
        service.verifyChallenge(challengeId, '123456', '127.0.0.1', mockPool)
      ).rejects.toThrow(HttpException);
    });
  });

  describe('resendChallenge', () => {
    const challengeId = '00000000-0000-0000-0000-000000000000';
    const destination = 'user@example.com';

    beforeEach(() => {
      mockPool.query.mockResolvedValueOnce({
        rows: [
          {
            challenge_id: challengeId,
            destination,
            consumed_at: null,
            expires_at: new Date(Date.now() + 60_000),
            resend_count: 0,
          },
        ],
        rowCount: 1,
      });
    });

    it('resends successfully', async () => {
      mockPool.query.mockResolvedValueOnce({ rows: [], rowCount: 1 });

      const result = await service.resendChallenge(challengeId, '127.0.0.1', 'registration');
      expect(result).toEqual({ challengeId });

      expect(mockPool.query.mock.calls).toHaveLength(2);
      const updateSql = mockPool.query.mock.calls[1]![0] as string;
      expect(updateSql).toContain('UPDATE otp_challenges');
      expect(updateSql).toContain('otp_hash');
      expect(updateSql).not.toContain('attempts_remaining =');
    });

    it('throws 404 when challenge not found', async () => {
      mockPool.query.mockReset();
      mockPool.query.mockResolvedValue({ rows: [], rowCount: 0 });
      mockRateLimitService.checkSecurityRateLimit.mockReset();
      mockRateLimitService.checkSecurityRateLimit.mockResolvedValue({ allowed: true });

      await expect(
        service.resendChallenge(challengeId, '127.0.0.1', 'registration')
      ).rejects.toThrow(HttpException);
    });

    it('rejects consumed challenge', async () => {
      mockPool.query.mockReset();
      mockPool.query.mockResolvedValue({
        rows: [
          {
            challenge_id: challengeId,
            destination,
            consumed_at: new Date(),
            expires_at: new Date(Date.now() + 60_000),
            resend_count: 0,
          },
        ],
        rowCount: 1,
      });
      mockRateLimitService.checkSecurityRateLimit.mockReset();
      mockRateLimitService.checkSecurityRateLimit.mockResolvedValue({ allowed: true });

      try {
        await service.resendChallenge(challengeId, '127.0.0.1', 'registration');
        expect.unreachable();
      } catch (err) {
        const httpErr = err as any;
        expect(httpErr.status).toBe(409);
        expect(httpErr.response).toHaveProperty('error', ErrorCodes.AUTH_OTP_CONSUMED.code);
      }
    });

    it('rejects expired challenge', async () => {
      mockPool.query.mockReset();
      mockPool.query.mockResolvedValue({
        rows: [
          {
            challenge_id: challengeId,
            destination,
            consumed_at: null,
            expires_at: new Date(Date.now() - 60_000),
            resend_count: 0,
          },
        ],
        rowCount: 1,
      });
      mockRateLimitService.checkSecurityRateLimit.mockReset();
      mockRateLimitService.checkSecurityRateLimit.mockResolvedValue({ allowed: true });

      try {
        await service.resendChallenge(challengeId, '127.0.0.1', 'registration');
        expect.unreachable();
      } catch (err) {
        const httpErr = err as any;
        expect(httpErr.status).toBe(401);
        expect(httpErr.response).toHaveProperty('error', ErrorCodes.AUTH_OTP_EXPIRED.code);
      }
    });
  });

  describe('createLoginChallenge', () => {
    const userId = 'user-uuid-v7';
    const destination = '+989****4567';
    const ip = '192.168.1.1';

    beforeEach(() => {
      vi.stubEnv('AUTH_DELIVERY_ENCRYPTION_KEY', 'unit-test-delivery-key-only');
      vi.clearAllMocks();
      mockRateLimitService.checkSecurityRateLimit.mockResolvedValue({ allowed: true });
      mockPool.query.mockResolvedValue({ rows: [], rowCount: 1 });
    });

    it('creates a login OTP challenge with user_id', async () => {
      const result = await service.createLoginChallenge(userId, destination, ip);

      expect(result).toHaveProperty('challengeId');
      expect(result).toHaveProperty('destination', destination);
      expect(mockRateLimitService.checkSecurityRateLimit).toHaveBeenCalled();
      expect(mockPool.query).toHaveBeenCalledTimes(1);

      const sql = mockPool.query.mock.calls[0]![0] as string;
      const params = mockPool.query.mock.calls[0]![1] as unknown[];
      expect(sql).toContain('INSERT INTO otp_challenges');
      expect(sql).toContain('user_id');
      expect(params[3]).toBe(userId); // user_id in 4th position
      expect(params[1]).toBe(destination);
      expect(typeof params[0]).toBe('string');
      expect(typeof params[2]).toBe('string');
      expect(params[4]).toBe(OtpService.MAX_ATTEMPTS);
    });
  });
});
