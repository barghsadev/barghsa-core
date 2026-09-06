import { afterEach, expect, it, vi } from 'vitest';
import {
  encryptStorageSecret,
  decryptStorageSecret,
  runtimeStorageProvider,
} from './runtime-config.js';
afterEach(() => vi.unstubAllEnvs());
const fields = {
  endpoint: 'https://default.example.test',
  privateEndpointUrl: 'https://private.example.test',
  publicEndpointUrl: 'https://browser.example.test',
  region: 'us-east-1',
  bucket: 'test-bucket',
  accessKeyId: 'first-key',
  forcePathStyle: true,
};
it('encrypts secrets with authenticated encryption and refuses a missing or wrong key', () => {
  vi.stubEnv('STORAGE_CONFIG_ENCRYPTION_KEY', '');
  expect(() => encryptStorageSecret('private')).toThrow();
  vi.stubEnv('STORAGE_CONFIG_ENCRYPTION_KEY', 'test-storage-encryption-key');
  const first = encryptStorageSecret('private')!;
  expect(first).not.toBe(encryptStorageSecret('private'));
  expect(first).not.toContain('private');
  expect(decryptStorageSecret(first)).toBe('private');
  vi.stubEnv('STORAGE_CONFIG_ENCRYPTION_KEY', 'different-key');
  expect(() => decryptStorageSecret(first)).toThrow();
});
it('uses the browser endpoint for scoped URLs and refreshes credentials on every operation', async () => {
  vi.stubEnv('STORAGE_CONFIG_ENCRYPTION_KEY', 'test-storage-encryption-key');
  let value = { ...fields, encryptedSecret: encryptStorageSecret('first-secret') };
  const load = vi.fn(async () => value);
  const provider = runtimeStorageProvider(load);
  const first = new URL(await provider.presignedPutUrl('uploads/proof.pdf', 60));
  expect(first.origin).toBe(fields.publicEndpointUrl);
  expect(first.searchParams.get('X-Amz-Credential')).toContain('first-key/');
  expect(first.searchParams.get('X-Amz-Expires')).toBe('60');
  value = {
    ...value,
    accessKeyId: 'second-key',
    encryptedSecret: encryptStorageSecret('second-secret'),
  };
  const second = new URL(await provider.presignedGetUrl('sealed/proof.pdf', 90));
  expect(second.searchParams.get('X-Amz-Credential')).toContain('second-key/');
  const restarted = runtimeStorageProvider(load);
  expect(
    new URL(await restarted.presignedGetUrl('sealed/proof.pdf')).searchParams.get(
      'X-Amz-Credential'
    )
  ).toContain('second-key/');
  expect(load).toHaveBeenCalledTimes(3);
});
it('does not silently fall back to environment credentials for invalid stored configuration', async () => {
  vi.stubEnv('S3_BUCKET', 'fallback-bucket');
  vi.stubEnv('S3_REGION', 'us-east-1');
  const provider = runtimeStorageProvider(async () => ({ ...fields, encryptedSecret: 'corrupt' }));
  await expect(provider.presignedGetUrl('file')).rejects.toThrow(
    'Storage configuration is unavailable'
  );
});
