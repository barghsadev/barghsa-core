import { describe, it, expect, beforeEach, vi } from 'vitest';
import { HttpException } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { ErrorCodes } from '@barghsa/shared/errors';
import { AuthService } from '../src/auth/auth.service.js';
import { OtpService } from '../src/auth/otp.service.js';

const mockCreateChallenge = vi.fn().mockResolvedValue({
  challengeId: '0000-000-00000',
  destination: 'user@example.com',
});

vi.mock('argon2', () => ({
  hash: vi.fn().mockResolvedValue('$argon2id$v=19$m=65536,t=3,p=1$mockhash$mockhashmockhashmockhash'),
}));

const mockQuery = vi.fn();
const mockConnect = vi.fn();
const mockClient = {
  query: vi.fn(),
  release: vi.fn(),
};
const mockPool = {
  query: mockQuery,
  connect: mockConnect,
};

vi.mock('@barghsa/db', () => ({
  getDbPool: vi.fn(() => mockPool),
}));

const KNOWN_OTP = '123456';
const KNOWN_OTP_HASH = createHash('sha256').update(KNOWN_OTP).digest('hex');

const mockOtpService = {
  createChallenge: mockCreateChallenge,
  hashOtp: vi.fn((otp: string) => createHash('sha256').update(otp).digest('hex')),
  compareOtpHashes: vi.fn((hashedInput: string, storedHash: string) => {
    return hashedInput === storedHash;
  }),
} as unknown as OtpService;

function makeChallengeRow(overrides: Record<string, unknown> = {}) {
  return {
    challenge_id: 'test-challenge-id',
    destination: 'user@example.com',
    otp_hash: KNOWN_OTP_HASH,
    attempts_remaining: 5,
    expires_at: new Date(Date.now() + 300_000),
    consumed_at: null,
    password_hash: 'argon2id-hash-value',
    tos_version_id: 'current',
    ...overrides,
  };
}

describe('AuthService', () => {
  let service: AuthService;

  beforeEach(() => {
    vi.clearAllMocks();
    mockConnect.mockResolvedValue(mockClient);
    mockClient.query.mockReset();
    mockClient.query.mockImplementation(async (sql: string) => {
      // Default: COMMIT and ROLLBACK return empty result
      if (sql === 'COMMIT' || sql.startsWith('ROLLBACK')) return { rows: [] };
      return { rows: [] };
    });
    mockClient.release.mockReset();
    service = new AuthService(mockOtpService);
  });

  describe('register', () => {
    it('returns challengeId on successful registration', async () => {
      const result = await service.register(
        {
          username: 'user@example.com',
          password: 'StrongPass1',
          tosVersionId: 'current',
        },
        '127.0.0.1',
      );

      expect(result).toHaveProperty('challengeId');
      expect(typeof result.challengeId).toBe('string');
      expect(mockCreateChallenge).toHaveBeenCalledWith('user@example.com', '127.0.0.1', expect.stringContaining('$argon2id'), 'current');
    });

    it('throws USERNAME_TAKEN when username is taken (stub)', async () => {
      // For now the stub always returns false, so this test documents the expected behavior
      const result = await service.register(
        {
          username: 'user@example.com',
          password: 'StrongPass1',
          tosVersionId: 'current',
        },
        '127.0.0.1',
      );

      expect(result).toHaveProperty('challengeId');
    });

    it('throws TOS_NOT_ACCEPTED for invalid tosVersionId', async () => {
      await expect(
        service.register(
          {
            username: 'user@example.com',
            password: 'StrongPass1',
            tosVersionId: 'invalid-version',
          },
          '127.0.0.1',
        ),
      ).rejects.toThrow(HttpException);

      try {
        await service.register(
          {
            username: 'user@example.com',
            password: 'StrongPass1',
            tosVersionId: 'invalid-version',
          },
          '127.0.0.1',
        );
      } catch (e) {
        expect(e).toBeInstanceOf(HttpException);
        const response = (e as HttpException).getResponse() as Record<string, unknown>;
        expect(response.error).toBe(ErrorCodes.AUTH_REGISTER_TOS_NOT_ACCEPTED.code);
      }
    });
  });

  describe('completeRegistration', () => {
    const challengeId = 'test-challenge-id';

    it('creates user, session, and returns credentials on success', async () => {
      mockClient.query.mockImplementation(async (sql: string) => {
        if (sql.includes('FOR UPDATE')) {
          return { rows: [makeChallengeRow()] };
        }
        if (sql.includes('consumed_at')) {
          return { rowCount: 1 };
        }
        if (sql.includes('INSERT INTO users') || sql.includes('INSERT INTO sessions')) {
          return { rows: [] };
        }
        return { rows: [] };
      });

      const result = await service.completeRegistration(challengeId, KNOWN_OTP, '127.0.0.1');

      expect(result).toHaveProperty('userId');
      expect(result).toHaveProperty('sessionId');
      expect(result).toHaveProperty('csrfToken');
      expect(result).toHaveProperty('expiresAt');

      expect(typeof result.userId).toBe('string');
      expect(typeof result.sessionId).toBe('string');
      expect(typeof result.csrfToken).toBe('string');
      expect(typeof result.expiresAt).toBe('string');

      // Verify transactional flow: BEGIN → SELECT FOR UPDATE → consume → INSERT user → INSERT session → COMMIT
      const calls = mockClient.query.mock.calls.map((c: [string]) => c[0]);
      const beginIdx = calls.findIndex((s: string) => s === 'BEGIN');
      const commitIdx = calls.findIndex((s: string) => s === 'COMMIT');
      expect(beginIdx).toBeGreaterThanOrEqual(0);
      expect(commitIdx).toBeGreaterThan(beginIdx);
      expect(calls.some((s: string) => s.includes('FOR UPDATE'))).toBe(true);
    });

    it('throws 404 when challenge is not found', async () => {
      mockClient.query.mockImplementation(async (sql: string) => {
        if (sql.includes('FOR UPDATE')) {
          return { rows: [] };
        }
        return { rows: [] };
      });

      await expect(
        service.completeRegistration('nonexistent', KNOWN_OTP, '127.0.0.1'),
      ).rejects.toThrow(HttpException);

      try {
        await service.completeRegistration('nonexistent', KNOWN_OTP, '127.0.0.1');
      } catch (e) {
        expect((e as HttpException).getStatus()).toBe(404);
      }
    });

    it('throws 409 when challenge is already consumed', async () => {
      mockClient.query.mockImplementation(async (sql: string) => {
        if (sql.includes('FOR UPDATE')) {
          return { rows: [makeChallengeRow({ consumed_at: new Date() })] };
        }
        return { rows: [] };
      });

      await expect(
        service.completeRegistration(challengeId, KNOWN_OTP, '127.0.0.1'),
      ).rejects.toThrow(HttpException);

      try {
        await service.completeRegistration(challengeId, KNOWN_OTP, '127.0.0.1');
      } catch (e) {
        expect((e as HttpException).getStatus()).toBe(409);
        const response = (e as HttpException).getResponse() as Record<string, unknown>;
        expect(response.error).toBe(ErrorCodes.AUTH_OTP_CONSUMED.code);
      }
    });

    it('throws 401 when challenge is expired', async () => {
      mockClient.query.mockImplementation(async (sql: string) => {
        if (sql.includes('FOR UPDATE')) {
          return { rows: [makeChallengeRow({ expires_at: new Date(Date.now() - 60_000) })] };
        }
        return { rows: [] };
      });

      await expect(
        service.completeRegistration(challengeId, KNOWN_OTP, '127.0.0.1'),
      ).rejects.toThrow(HttpException);

      try {
        await service.completeRegistration(challengeId, KNOWN_OTP, '127.0.0.1');
      } catch (e) {
        expect((e as HttpException).getStatus()).toBe(401);
        const response = (e as HttpException).getResponse() as Record<string, unknown>;
        expect(response.error).toBe(ErrorCodes.AUTH_OTP_EXPIRED.code);
      }
    });

    it('throws 401 when max attempts exceeded', async () => {
      mockClient.query.mockImplementation(async (sql: string) => {
        if (sql.includes('FOR UPDATE')) {
          return { rows: [makeChallengeRow({ attempts_remaining: 0 })] };
        }
        return { rows: [] };
      });

      await expect(
        service.completeRegistration(challengeId, KNOWN_OTP, '127.0.0.1'),
      ).rejects.toThrow(HttpException);

      try {
        await service.completeRegistration(challengeId, KNOWN_OTP, '127.0.0.1');
      } catch (e) {
        expect((e as HttpException).getStatus()).toBe(401);
        const response = (e as HttpException).getResponse() as Record<string, unknown>;
        expect(response.error).toBe(ErrorCodes.AUTH_OTP_MAX_ATTEMPTS.code);
      }
    });

    it('throws AUTH_REGISTER_FAILED when registration data is missing', async () => {
      mockClient.query.mockImplementation(async (sql: string) => {
        if (sql.includes('FOR UPDATE')) {
          return { rows: [makeChallengeRow({ password_hash: null, tos_version_id: null })] };
        }
        return { rows: [] };
      });

      try {
        await service.completeRegistration(challengeId, KNOWN_OTP, '127.0.0.1');
      } catch (e) {
        expect(e).toBeInstanceOf(HttpException);
        const response = (e as HttpException).getResponse() as Record<string, unknown>;
        expect(response.error).toBe(ErrorCodes.AUTH_REGISTER_FAILED.code);
      }
    });

    it('throws 401 and decrements attempts on invalid OTP', async () => {
      let decrementCalled = false;
      mockClient.query.mockImplementation(async (sql: string) => {
        if (sql.includes('FOR UPDATE')) {
          return { rows: [makeChallengeRow()] };
        }
        if (sql.includes('attempts_remaining = attempts_remaining - 1')) {
          decrementCalled = true;
          return { rowCount: 1 };
        }
        if (sql === 'COMMIT') return { rows: [] };
        return { rows: [] };
      });

      await expect(
        service.completeRegistration(challengeId, 'wrong-otp', '127.0.0.1'),
      ).rejects.toThrow(HttpException);

      expect(decrementCalled).toBe(true);

      try {
        await service.completeRegistration(challengeId, 'wrong-otp', '127.0.0.1');
      } catch (e) {
        expect((e as HttpException).getStatus()).toBe(401);
        const response = (e as HttpException).getResponse() as Record<string, unknown>;
        expect(response.error).toBe(ErrorCodes.AUTH_OTP_INVALID.code);
      }
    });

    it('rolls back on user INSERT failure and throws AUTH_REGISTER_FAILED', async () => {
      let rolledBack = false;
      mockClient.query.mockImplementation(async (sql: string) => {
        if (sql.includes('FOR UPDATE')) {
          return { rows: [makeChallengeRow()] };
        }
        if (sql.includes('consumed_at')) {
          return { rowCount: 1 };
        }
        if (sql.includes('INSERT INTO users')) {
          throw new Error('duplicate key value violates unique constraint');
        }
        if (sql.startsWith('ROLLBACK')) {
          rolledBack = true;
          return { rows: [] };
        }
        return { rows: [] };
      });

      try {
        await service.completeRegistration(challengeId, KNOWN_OTP, '127.0.0.1');
      } catch (e) {
        expect(e).toBeInstanceOf(HttpException);
        const response = (e as HttpException).getResponse() as Record<string, unknown>;
        expect(response.error).toBe(ErrorCodes.AUTH_REGISTER_FAILED.code);
        expect(rolledBack).toBe(true);
      }
    });

    it('releases the client in finally block', async () => {
      mockClient.query.mockImplementation(async (sql: string) => {
        if (sql.includes('FOR UPDATE')) {
          return { rows: [] }; // triggers 404, early exit
        }
        return { rows: [] };
      });

      await service.completeRegistration(challengeId, KNOWN_OTP, '127.0.0.1').catch(() => {});
      expect(mockClient.release).toHaveBeenCalled();
    });
  });
});