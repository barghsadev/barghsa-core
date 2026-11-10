import { Logger } from '@nestjs/common';
import { expect, it, vi } from 'vitest';
import type { AuthenticatedRequest } from '../session/session.guard.js';
import { CrmV2Controller } from './crm-v2.controller.js';
import type { CrmV2Service } from './crm-v2.service.js';

const target = '11111111-2222-4333-8444-555555555555';

it.each([
  { method: 'forcePasswordChange', diagnostic: 'Password change forced' },
  { method: 'expireSessions', diagnostic: 'Sessions expired' },
  { method: 'deleteProfile', diagnostic: 'archived' },
] as const)('keeps the reason for $method out of process logs', async ({ method, diagnostic }) => {
  const reason = 'fixture-only private case details\nfor review';
  const request = {
    session: { userId: 'actor', permissions: ['admin:users:edit'], operatingContext: 'staff' },
    ip: '127.0.0.1',
  } as AuthenticatedRequest;
  const perform = vi.fn().mockResolvedValue({ success: true, archivedAt: '2026-11-10T00:00:00Z' });
  const service = { [method]: perform } as unknown as CrmV2Service;
  const log = vi.spyOn(Logger.prototype, 'debug').mockImplementation(() => undefined);
  try {
    const result = await new CrmV2Controller(service)[method](target, { reason }, request);
    expect(result.success).toBe(true);
    expect(perform).toHaveBeenCalledWith(target, reason, request.session, request.ip);
    expect(log).toHaveBeenCalledWith(expect.stringContaining(diagnostic));
    expect(log).not.toHaveBeenCalledWith(
      expect.stringContaining('fixture-only private case details')
    );
  } finally {
    log.mockRestore();
  }
});
