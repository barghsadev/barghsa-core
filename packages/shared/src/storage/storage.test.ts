import { describe, it, expect, vi } from 'vitest';
import {
  StorageObjectNotFound,
  StorageProviderError,
} from './storage-provider.js';
import { S3StorageProvider, type S3StorageProviderConfig } from './s3-storage-provider.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeConfig(overrides?: Partial<S3StorageProviderConfig>): S3StorageProviderConfig {
  return {
    bucket: 'test-bucket',
    region: 'us-east-1',
    endpoint: 'http://localhost:9000', // MinIO default — won't actually connect
    accessKeyId: 'minioadmin',
    secretAccessKey: 'minioadmin',
    forcePathStyle: true,
    maxRetries: 0, // fail fast for tests
    requestTimeoutMs: 100,
    ...overrides,
  };
}

describe('StorageObjectNotFound', () => {
  it('sets correct name and message', () => {
    const err = new StorageObjectNotFound('photos/sunset.jpg');
    expect(err.name).toBe('StorageObjectNotFound');
    expect(err.message).toBe('Object not found: photos/sunset.jpg');
    expect(err.key).toBe('photos/sunset.jpg');
  });

  it('accepts a custom message', () => {
    const err = new StorageObjectNotFound('doc.pdf', 'Custom message');
    expect(err.message).toBe('Custom message');
    expect(err.key).toBe('doc.pdf');
  });
});

describe('StorageProviderError', () => {
  it('wraps a cause', () => {
    const cause = new Error('connection refused');
    const err = new StorageProviderError('failed to put object', cause);
    expect(err.name).toBe('StorageProviderError');
    expect(err.message).toBe('failed to put object');
    expect(err.cause).toBe(cause);
  });
});

describe('S3StorageProvider', () => {
  it('constructs without throwing', () => {
    expect(() => new S3StorageProvider(makeConfig())).not.toThrow();
  });

  it('constructs with prefix', () => {
    const provider = new S3StorageProvider(makeConfig({ prefix: 'production/' }));
    expect(provider).toBeDefined();
  });

  describe('listObjects — no-op (idempotent)', () => {
    it('does not throw on non-existent prefix when S3 is unreachable', async () => {
      // The client should eventually reject, but not before we test the
      // error-shape at the S3 client level.  Since we're not connecting to
      // a real endpoint we expect a network-level StorageProviderError.
      const provider = new S3StorageProvider(makeConfig());
      await expect(provider.listObjects('nonexistent/')).rejects.toThrow(StorageProviderError);
    });
  });
});

describe('getObject — no-op error shapes', () => {
  it('throws StorageProviderError when S3 endpoint is unreachable', async () => {
    const provider = new S3StorageProvider(makeConfig());
    await expect(provider.getObject('missing/key.txt')).rejects.toThrow(StorageProviderError);
  });
});

describe('deleteObject — idempotent error shapes', () => {
  it('throws StorageProviderError when S3 endpoint is unreachable', async () => {
    const provider = new S3StorageProvider(makeConfig());
    // Deleting a non-existent key is not an error per the contract, but
    // a network failure should still propagate.
    await expect(provider.deleteObject('missing/key.txt')).rejects.toThrow(StorageProviderError);
  });
});

describe('putObject — error shapes', () => {
  it('throws StorageProviderError when S3 endpoint is unreachable', async () => {
    const provider = new S3StorageProvider(makeConfig());
    await expect(
      provider.putObject('test.txt', 'hello', 'text/plain'),
    ).rejects.toThrow(StorageProviderError);
  });
});

describe('presignedPutUrl — local signing (no network needed)', () => {
  it('returns a URL string without throwing', async () => {
    const provider = new S3StorageProvider(makeConfig());
    const url = await provider.presignedPutUrl('test.txt');
    expect(url).toContain('X-Amz-Signature');
    expect(url).toContain('test-bucket');
  });
});

describe('presignedGetUrl — local signing (no network needed)', () => {
  it('returns a URL string without throwing', async () => {
    const provider = new S3StorageProvider(makeConfig());
    const url = await provider.presignedGetUrl('test.txt');
    expect(url).toContain('X-Amz-Signature');
    expect(url).toContain('test-bucket');
  });
});