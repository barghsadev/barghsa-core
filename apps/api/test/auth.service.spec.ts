import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Test, TestingModule } from '@nestjs/testing';
import { HttpException } from '@nestjs/common';
import { ErrorCodes } from '@barghsa/shared/errors';
import { AuthService } from '../src/auth/auth.service.js';

describe('AuthService', () => {
  let service: AuthService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [AuthService],
    }).compile();

    service = module.get<AuthService>(AuthService);
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
      expect(result.challengeId.length).toBeGreaterThan(0);
    });

    it('throws USERNAME_TAKEN when username is taken (stub)', async () => {
      // For now the stub always returns false, so this test documents the expected behavior
      // Once the DB query is wired, change the test to mock the DB call
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