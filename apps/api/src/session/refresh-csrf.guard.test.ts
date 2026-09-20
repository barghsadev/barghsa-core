import { afterEach, describe, expect, it, vi } from 'vitest';
import { ForbiddenException, Logger, type ExecutionContext } from '@nestjs/common';
import { correlationIdStorage } from '../common/correlation-id.middleware.js';
import { RefreshCsrfGuard } from './refresh-csrf.guard.js';
import type { SessionService } from './session.service.js';

describe('RefreshCsrfGuard security logging', () => {
  afterEach(() => vi.restoreAllMocks());

  it.each([undefined, '', ['private-submitted-token'], 'private-submitted-token'])(
    'logs rejection without refresh or CSRF credentials (%s)',
    async (csrfToken) => {
      const warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => {});
      const sessions = { validateRefreshCsrf: vi.fn().mockResolvedValue(false) };
      const guard = new RefreshCsrfGuard(sessions as unknown as SessionService);
      const context = {
        switchToHttp: () => ({
          getRequest: () => ({
            method: 'POST',
            cookies: { barghsa_refresh: 'private-refresh-credential' },
            headers: { 'x-csrf-token': csrfToken },
          }),
        }),
      } as unknown as ExecutionContext;
      const correlationId = '01990d22-6699-7000-8000-000000000002';
      await correlationIdStorage.run(correlationId, async () => {
        await expect(guard.canActivate(context)).rejects.toThrow(ForbiddenException);
      });
      expect(warn).toHaveBeenCalledTimes(1);
      const log = String(warn.mock.calls[0]![0]);
      expect(log).toContain('CSRF check failed');
      expect(log).toContain(`correlationId=${correlationId}`);
      expect(log).toContain('method=POST');
      expect(log).not.toContain('private-refresh-credential');
      expect(log).not.toContain('private-submitted-token');
    }
  );
});
