import { randomUUID } from 'node:crypto';
import { expect, it, vi } from 'vitest';
import type { AuthenticatedRequest } from '../session/session.guard.js';
import { SecurityRateLimitConfigController } from './security-rate-limit-config.controller.js';
import {
  activateSecurityRateLimitRecovery,
  stageSecurityRateLimitRecovery,
  updateSecurityRateLimitConfig,
} from './security-rate-limit-config.js';

vi.mock('./security-rate-limit-config.js', async (original) => ({
  ...(await original<typeof import('./security-rate-limit-config.js')>()),
  activateSecurityRateLimitRecovery: vi.fn(),
  stageSecurityRateLimitRecovery: vi.fn(),
  updateSecurityRateLimitConfig: vi.fn(),
}));

it('preserves the authenticated actor in rate-limit changes without a request IP', () => {
  const controller = new SecurityRateLimitConfigController();
  const request = {
    session: {
      userId: 'limit-editor',
      sessionId: randomUUID(),
      csrfToken: randomUUID(),
      operatingContext: 'staff',
      permissions: ['admin:config:write'],
    },
  } as AuthenticatedRequest;
  const policy = 'login';
  const update = { policy, expectedVersion: 2, limit: 8, emergency: { operation: 'keep' } };
  const draft = { policy, expectedVersion: 3, sourceId: randomUUID() };
  const activate = { policy, expectedVersion: 3, draftId: randomUUID() };
  controller.update(update, request);
  controller.stage(draft, request);
  controller.activate(activate, request);
  expect(updateSecurityRateLimitConfig).toHaveBeenCalledExactlyOnceWith(
    update,
    request.session,
    'unknown'
  );
  expect(stageSecurityRateLimitRecovery).toHaveBeenCalledExactlyOnceWith(
    draft,
    request.session,
    'unknown'
  );
  expect(activateSecurityRateLimitRecovery).toHaveBeenCalledExactlyOnceWith(
    activate,
    request.session,
    'unknown'
  );
});
