import { describe, expect, it, vi } from 'vitest';
import { VerificationProviderController } from './verification-provider.controller.js';
import type { AuthenticatedRequest } from '../session/session.guard.js';

const config = { providerId: 'test-adapter', enabled: false, settings: {} };
function request(permissions: string[]): AuthenticatedRequest {
  return { session: { userId: 'staff', permissions, isAdmin: false } } as AuthenticatedRequest;
}
function fixture() {
  const service = {
    listProviders: vi.fn().mockReturnValue([]),
    getAdapter: vi.fn().mockReturnValue({ displayName: 'Test adapter' }),
    getProviderConfig: vi.fn().mockResolvedValue(config),
    setProviderConfig: vi.fn(),
    resetCircuitBreaker: vi.fn().mockReturnValue(true),
    verify: vi.fn().mockResolvedValue({ status: 'unavailable' }),
  };
  return { service, controller: new VerificationProviderController(service as never) };
}
type Operation = {
  name: string;
  permission: string;
  run: (c: VerificationProviderController, r: AuthenticatedRequest) => unknown;
};
const operations: Operation[] = [
  { name: 'provider list', permission: 'admin:config:read', run: (c, r) => c.listProviders(r) },
  {
    name: 'configuration read',
    permission: 'admin:config:read',
    run: (c, r) => c.getProviderConfig(config.providerId, r),
  },
  {
    name: 'configuration write',
    permission: 'admin:config:write',
    run: (c, r) => c.setProviderConfig(config.providerId, config, r),
  },
  {
    name: 'breaker reset',
    permission: 'admin:config:write',
    run: (c, r) => c.resetCircuitBreaker(config.providerId, r),
  },
  {
    name: 'verification request',
    permission: 'verification:write',
    run: (c, r) => c.runVerification({ providerId: config.providerId, input: {} }, r),
  },
];
describe.each(operations)('$name permission boundary', ({ permission, run }) => {
  it('requires its own capability and immediately respects revocation', async () => {
    const { controller, service } = fixture();
    const req = request([permission]);
    await run(controller, req);
    for (const call of Object.values(service)) call.mockClear();
    req.session.permissions =
      permission === 'admin:config:read' ? ['admin:config:write'] : ['admin:config:read'];
    await expect(Promise.resolve().then(() => run(controller, req))).rejects.toMatchObject({
      status: 403,
    });
    for (const call of Object.values(service)) expect(call).not.toHaveBeenCalled();
  });
});
it('defaults unconfigured adapters to disabled without creating configuration', async () => {
  const { controller, service } = fixture();
  service.getProviderConfig.mockResolvedValue(null as never);
  expect(
    await controller.getProviderConfig(config.providerId, request(['admin:config:read']))
  ).toEqual({ providerId: config.providerId, displayName: 'Test adapter', config });
  expect(service.setProviderConfig).not.toHaveBeenCalled();
});
it.each(['read', 'write', 'reset'])('returns 404 for unknown provider %s', async (action) => {
  const { controller, service } = fixture();
  service.getAdapter.mockReturnValue(undefined as never);
  service.resetCircuitBreaker.mockReturnValue(false);
  const req = request(['*']);
  const result =
    action === 'read'
      ? controller.getProviderConfig('missing', req)
      : action === 'write'
        ? controller.setProviderConfig('missing', { ...config, providerId: 'missing' }, req)
        : controller.resetCircuitBreaker('missing', req);
  await expect(result).rejects.toMatchObject({ status: 404 });
  expect(service.setProviderConfig).not.toHaveBeenCalled();
});
it.each([
  null,
  {},
  { ...config, enabled: 'true' },
  { ...config, settings: { secret: 1 } },
  { ...config, providerId: 'different' },
])('rejects invalid or mismatched configuration %j before writes', async (body) => {
  const { controller, service } = fixture();
  await expect(
    controller.setProviderConfig(config.providerId, body, request(['admin:config:write']))
  ).rejects.toMatchObject({ status: 400 });
  expect(service.getAdapter).not.toHaveBeenCalled();
  expect(service.setProviderConfig).not.toHaveBeenCalled();
});
it.each([null, {}, { providerId: '', input: {} }, { providerId: 'test-adapter', input: [] }])(
  'rejects malformed verification request %j before invoking a provider',
  async (body) => {
    const { controller, service } = fixture();
    await expect(
      controller.runVerification(body, request(['verification:write']))
    ).rejects.toMatchObject({ status: 400 });
    expect(service.verify).not.toHaveBeenCalled();
  }
);
