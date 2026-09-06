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
