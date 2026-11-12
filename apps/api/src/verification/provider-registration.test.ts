import { afterEach, expect, it, vi } from 'vitest';
import { VerificationProviderService } from './verification-provider.service.js';

afterEach(() => vi.unstubAllEnvs());
it.each(['production', '', 'staging'])('never registers the success stub in %s', (environment) => {
  vi.stubEnv('NODE_ENV', environment);
  vi.stubEnv('ENABLE_VERIFICATION_STUB', 'true');
  const service = new VerificationProviderService();
  service.onModuleInit();
  expect(service.listProviders()).toEqual([]);
});
it.each(['test', 'development'])('requires explicit opt-in in %s', (environment) => {
  vi.stubEnv('NODE_ENV', environment);
  vi.stubEnv('ENABLE_VERIFICATION_STUB', '');
  const service = new VerificationProviderService();
  service.onModuleInit();
  expect(service.listProviders()).toEqual([]);
  vi.stubEnv('ENABLE_VERIFICATION_STUB', 'true');
  service.onModuleInit();
  expect(service.listProviders()).toHaveLength(1);
});

it('fails closed before saving nonempty settings without a provider key', async () => {
  vi.stubEnv('PROVIDER_CONFIG_ENCRYPTION_KEY', '');
  vi.stubEnv('PROVIDER_CONFIG_ENCRYPTION_KEY_ID', '');
  vi.stubEnv('PROVIDER_CONFIG_ENCRYPTION_PREVIOUS_KEY', '');
  vi.stubEnv('PROVIDER_CONFIG_ENCRYPTION_PREVIOUS_KEY_ID', '');
  const service = new VerificationProviderService();
  await expect(
    service.setProviderConfig('stub', {
      providerId: 'stub',
      enabled: true,
      settings: { token: 'synthetic-provider-setting' },
    })
  ).rejects.toMatchObject({
    status: 503,
    response: { error: 'VERIFICATION:PROVIDER:UNAVAILABLE' },
  });
});
