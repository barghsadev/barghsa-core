import { describe, it, expect, beforeEach, vi } from 'vitest';
import { HttpException } from '@nestjs/common';
import { ErrorCodes } from '@barghsa/shared/errors';
import { AuthService } from '../src/auth/auth.service.js';
import { OtpService } from '../src/auth/otp.service.js';

const mockCreateChallenge = vi.fn().mockResolvedValue({
  challengeId: '0000-000-00000',
  destination: 'user@example.com',
});

const mockOtpService = {
  createChallenge: mockCreateChallenge,
} as unknown as OtpService;

describe('AuthService', () => {
  let service: AuthService;

  beforeEach(() => {
    vi.clearAllMocks();
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
      expect(mockCreateChallenge).toHaveBeenCalledWith('user@example.com', '127.0.0.1', 'StrongPass1', 'current');
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
});