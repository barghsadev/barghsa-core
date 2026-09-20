import { describe, it, expect, vi } from 'vitest';
import { UnauthorizedException } from '@nestjs/common';
import { SessionAuthGuard, SessionOptionalGuard } from './session.guard.js';
import { SessionService } from './session.service.js';

function createMockExecutionContext(cookie?: string) {
  return {
    switchToHttp: () => ({
      getRequest: () => ({
        cookies: cookie ? { barghsa_session: cookie } : {},
      }),
    }),
  } as unknown as any;
}

describe('SessionAuthGuard', () => {
  describe('canActivate', () => {
    it('rejects requests without a session cookie', async () => {
      const mockSessionService = {
        validateSession: vi.fn(),
      } as unknown as SessionService;

      const guard = new SessionAuthGuard(mockSessionService);
      const context = createMockExecutionContext();

      await expect(guard.canActivate(context)).rejects.toThrow(UnauthorizedException);
      expect(mockSessionService.validateSession).not.toHaveBeenCalled();
    });
  });
});

describe('SessionOptionalGuard', () => {
  describe('canActivate', () => {
    it('allows requests without a session cookie', async () => {
      const mockSessionService = {
        validateSession: vi.fn(),
      } as unknown as SessionService;

      const guard = new SessionOptionalGuard(mockSessionService);
      const context = createMockExecutionContext();

      const result = await guard.canActivate(context);
      expect(result).toBe(true);
      expect(mockSessionService.validateSession).not.toHaveBeenCalled();
    });
  });
});

for (const Guard of [SessionAuthGuard, SessionOptionalGuard]) {
  describe(`${Guard.name} request proof`, () => {
    it.each([
      { method: 'GET', skip: false, preauth: false, token: 'submitted', proof: undefined },
      {
        method: 'POST',
        skip: false,
        preauth: false,
        token: 'submitted',
        proof: { token: 'submitted', method: 'POST' },
      },
      {
        method: 'PUT',
        skip: false,
        preauth: false,
        token: undefined,
        proof: { token: '', method: 'PUT' },
      },
      { method: 'POST', skip: true, preauth: false, token: undefined, proof: undefined },
      {
        method: 'POST',
        skip: true,
        preauth: true,
        token: 'submitted',
        proof: { token: 'submitted', method: 'POST' },
      },
    ])(
      'preserves the request proof for $method skip=$skip preauth=$preauth',
      async ({ method, skip, preauth, token, proof }) => {
        const request = {
          method,
          headers: { 'x-csrf-token': token },
          cookies: { barghsa_session: 'session' },
        };
        const handler = () => {};
        Reflect.defineMetadata('skipCsrf', skip, handler);
        Reflect.defineMetadata('preauthCsrf', preauth, handler);
        const context = {
          switchToHttp: () => ({ getRequest: () => request }),
          getHandler: () => handler,
        } as unknown as any;
        const service = {
          validateSession: vi.fn().mockResolvedValue({
            sessionId: 'session',
            userId: 'user',
            csrfToken: 'current-server-token',
            isAdmin: false,
            stepUpVerifiedAt: null,
          }),
        };
        await expect(
          new Guard(service as unknown as SessionService).canActivate(context)
        ).resolves.toBe(true);
        expect(service.validateSession).toHaveBeenCalledWith('session', true, proof);
      }
    );
  });
}
