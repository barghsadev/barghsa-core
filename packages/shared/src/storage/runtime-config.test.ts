import { afterEach, expect, it, vi } from 'vitest';
import { createServer } from 'node:http';
import { S3Client } from '@aws-sdk/client-s3';
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

it('health checks use current stored private endpoint and credentials, without reading objects', async () => {
  vi.stubEnv('STORAGE_CONFIG_ENCRYPTION_KEY', 'test-storage-encryption-key');
  const requests: Array<{ method: string | undefined; authorization: string }> = [];
  const server = createServer((request, response) => {
    requests.push({ method: request.method, authorization: request.headers.authorization ?? '' });
    response.writeHead(200).end();
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Missing endpoint');
    let value = {
      ...fields,
      privateEndpointUrl: `http://127.0.0.1:${address.port}`,
      encryptedSecret: encryptStorageSecret('first-secret'),
    };
    const provider = runtimeStorageProvider(async () => value);
    await provider.checkHealth!();
    value = {
      ...value,
      accessKeyId: 'rotated-key',
      encryptedSecret: encryptStorageSecret('second-secret'),
    };
    await provider.checkHealth!();
    expect(requests.map((r) => r.method)).toEqual(['HEAD', 'HEAD']);
    expect(requests[0]!.authorization).toContain('Credential=first-key/');
    expect(requests[1]!.authorization).toContain('Credential=rotated-key/');
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

it('closes both cached SDK clients and refuses operations after shutdown', async () => {
  vi.stubEnv('STORAGE_CONFIG_ENCRYPTION_KEY', 'test-storage-encryption-key');
  const destroy = vi.spyOn(S3Client.prototype, 'destroy');
  const load = vi.fn(async () => ({ ...fields, encryptedSecret: encryptStorageSecret('secret') }));
  const provider = runtimeStorageProvider(load);
  try {
    await provider.presignedGetUrl('proof.pdf');
    provider.destroy!();
    expect(destroy).toHaveBeenCalledTimes(2);
    await expect(provider.presignedGetUrl('proof.pdf')).rejects.toThrow(
      'Storage configuration is unavailable'
    );
    expect(load).toHaveBeenCalledTimes(1);
  } finally {
    destroy.mockRestore();
  }
});
it('does not recreate SDK clients if configuration resolves after shutdown', async () => {
  let release!: (value: null) => void;
  const provider = runtimeStorageProvider(
    () =>
      new Promise<null>((resolve) => {
        release = resolve;
      })
  );
  const request = provider.checkHealth!();
  provider.destroy!();
  release(null);
  await expect(request).rejects.toThrow('Storage configuration is unavailable');
});
