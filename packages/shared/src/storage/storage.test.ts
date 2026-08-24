import { describe, it, expect, vi } from 'vitest';
import {
  StorageObjectNotFound,
  StorageProviderError,
} from './storage-provider.js';
import { S3StorageProvider, type S3StorageProviderConfig } from './s3-storage-provider.js';
import { createStorageProvider } from './storage-factory.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeConfig(overrides?: Partial<S3StorageProviderConfig>): S3StorageProviderConfig {
  return {
    bucket: 'test-bucket',
    region: 'us-east-1',
    endpoint: 'http://localhost:9000',
    accessKeyId: 'minioadmin',
    secretAccessKey: 'minioadmin',
    forcePathStyle: true,
    maxRetries: 0,
    requestTimeoutMs: 100,
    ...overrides,
  };
}

/**
 * Create an S3StorageProvider with a mocked send function.
 * Returns [provider, sendMock] so tests can configure responses.
 */
function createMockedProvider(config?: Partial<S3StorageProviderConfig>): [S3StorageProvider, ReturnType<typeof vi.fn>] {
  const send = vi.fn();
  const provider = new S3StorageProvider(makeConfig(config));
  // Replace the internal S3Client.send with a controlled mock
  (provider as unknown as { client: { send: ReturnType<typeof vi.fn> } }).client.send = send;
  return [provider, send];
}

// ---------------------------------------------------------------------------
// StorageObjectNotFound
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// StorageProviderError
// ---------------------------------------------------------------------------

describe('StorageProviderError', () => {
  it('wraps a cause', () => {
    const cause = new Error('connection refused');
    const err = new StorageProviderError('failed to put object', cause);
    expect(err.name).toBe('StorageProviderError');
    expect(err.message).toBe('failed to put object');
    expect(err.cause).toBe(cause);
  });
});

// ---------------------------------------------------------------------------
// S3StorageProvider — construction
// ---------------------------------------------------------------------------

describe('S3StorageProvider', () => {
  it('constructs without throwing', () => {
    expect(() => new S3StorageProvider(makeConfig())).not.toThrow();
  });

  it('constructs with prefix', () => {
    const provider = new S3StorageProvider(makeConfig({ prefix: 'production/' }));
    expect(provider).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// putObject
// ---------------------------------------------------------------------------

describe('S3StorageProvider.putObject', () => {
  it('sends correct bucket, key, contentType, and metadata', async () => {
    const [provider, send] = createMockedProvider();
    send.mockResolvedValue({});

    await provider.putObject('photos/sunset.jpg', 'binary-data', 'image/jpeg', {
      author: 'user1',
    });

    expect(send).toHaveBeenCalledTimes(1);
    const cmd = send.mock.calls[0]![0];
    expect(cmd.input).toMatchObject({
      Bucket: 'test-bucket',
      Key: 'photos/sunset.jpg',
      ContentType: 'image/jpeg',
      Metadata: { author: 'user1' },
    });
  });

  it('respects prefix when resolving key', async () => {
    const [provider, send] = createMockedProvider({ prefix: 'production/' });
    send.mockResolvedValue({});

    await provider.putObject('config.json', '{}', 'application/json');

    const cmd = send.mock.calls[0]![0];
    expect(cmd.input.Key).toBe('production/config.json');
  });

  it('re-throws as StorageProviderError on failure', async () => {
    const [provider, send] = createMockedProvider();
    send.mockRejectedValue(new Error('net error'));

    await expect(provider.putObject('test.txt', 'hello', 'text/plain')).rejects.toThrow(
      StorageProviderError,
    );
  });
});

// ---------------------------------------------------------------------------
// getObject
// ---------------------------------------------------------------------------

describe('S3StorageProvider.getObject', () => {
  it('returns body, contentType, contentLength, metadata, etag', async () => {
    const [provider, send] = createMockedProvider();
    send.mockResolvedValue({
      Body: 'stream-data',
      ContentType: 'image/png',
      ContentLength: 42,
      Metadata: { author: 'user1' },
      ETag: '"abc123"',
    });

    const obj = await provider.getObject('photo.png');

    expect(obj.body).toBe('stream-data');
    expect(obj.contentType).toBe('image/png');
    expect(obj.contentLength).toBe(42);
    expect(obj.metadata).toEqual({ author: 'user1' });
    expect(obj.etag).toBe('"abc123"');
  });

  it('throws StorageObjectNotFound on NoSuchKey', async () => {
    const [provider, send] = createMockedProvider();
    const noSuchKeyError = new Error('The specified key does not exist.');
    noSuchKeyError.name = 'NoSuchKey';
    send.mockRejectedValue(noSuchKeyError);

    await expect(provider.getObject('missing.txt')).rejects.toThrow(StorageObjectNotFound);
  });

  it('throws StorageObjectNotFound on empty body', async () => {
    const [provider, send] = createMockedProvider();
    send.mockResolvedValue({ Body: undefined, ContentType: 'text/plain' });

    await expect(provider.getObject('empty.txt')).rejects.toThrow(StorageObjectNotFound);
  });

  it('re-throws as StorageProviderError on other errors', async () => {
    const [provider, send] = createMockedProvider();
    send.mockRejectedValue(new Error('access denied'));

    await expect(provider.getObject('restricted.txt')).rejects.toThrow(StorageProviderError);
  });
});

// ---------------------------------------------------------------------------
// deleteObject
// ---------------------------------------------------------------------------

describe('S3StorageProvider.deleteObject', () => {
  it('sends correct bucket and key', async () => {
    const [provider, send] = createMockedProvider();
    send.mockResolvedValue({});

    await provider.deleteObject('temp/file.txt');

    expect(send).toHaveBeenCalledTimes(1);
    const cmd = send.mock.calls[0]![0];
    expect(cmd.input).toMatchObject({ Bucket: 'test-bucket', Key: 'temp/file.txt' });
  });

  it('is idempotent (no error on non-existent key)', async () => {
    const [provider, send] = createMockedProvider();
    send.mockResolvedValue({});

    await expect(provider.deleteObject('never-existed.txt')).resolves.toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// presignedPutUrl / presignedGetUrl (local signing, no mock needed)
// ---------------------------------------------------------------------------

describe('presignedPutUrl', () => {
  it('returns a URL string without throwing', async () => {
    const provider = new S3StorageProvider(makeConfig());
    const url = await provider.presignedPutUrl('test.txt');
    expect(url).toContain('X-Amz-Signature');
    expect(url).toContain('test-bucket');
  });
});

describe('presignedGetUrl', () => {
  it('returns a URL string without throwing', async () => {
    const provider = new S3StorageProvider(makeConfig());
    const url = await provider.presignedGetUrl('test.txt');
    expect(url).toContain('X-Amz-Signature');
    expect(url).toContain('test-bucket');
  });
});

// ---------------------------------------------------------------------------
// listObjects
// ---------------------------------------------------------------------------

describe('S3StorageProvider.listObjects', () => {
  it('returns items with prefix stripped and continuationToken', async () => {
    const [provider, send] = createMockedProvider({ prefix: 'uploads/' });
    send.mockResolvedValue({
      Contents: [
        { Key: 'uploads/photo1.jpg', Size: 1024, ETag: '"e1"', LastModified: new Date('2026-01-01') },
        { Key: 'uploads/photo2.jpg', Size: 2048, ETag: '"e2"', LastModified: new Date('2026-01-02') },
      ],
      IsTruncated: true,
      NextContinuationToken: 'next-page-token',
    });

    const result = await provider.listObjects('', 10);

    expect(result.items).toHaveLength(2);
    expect(result.items[0]!.key).toBe('photo1.jpg'); // prefix stripped
    expect(result.items[0]!.size).toBe(1024);
    expect(result.items[0]!.etag).toBe('"e1"');
    expect(result.isTruncated).toBe(true);
    expect(result.continuationToken).toBe('next-page-token');
  });

  it('returns empty items list for an empty bucket', async () => {
    const [provider, send] = createMockedProvider();
    send.mockResolvedValue({ Contents: undefined, IsTruncated: false });

    const result = await provider.listObjects('nonexistent/');
    expect(result.items).toEqual([]);
    expect(result.isTruncated).toBe(false);
  });

  it('re-throws as StorageProviderError on failure', async () => {
    const [provider, send] = createMockedProvider();
    send.mockRejectedValue(new Error('s3 error'));

    await expect(provider.listObjects('prefix/')).rejects.toThrow(StorageProviderError);
  });
});

// ---------------------------------------------------------------------------
// createStorageProvider factory
// ---------------------------------------------------------------------------

describe('createStorageProvider', () => {
  it('returns a StorageProvider for default type (s3)', () => {
    const provider = createStorageProvider(makeConfig());
    expect(provider).toBeInstanceOf(S3StorageProvider);
  });

  it('returns a StorageProvider for explicit type "s3"', () => {
    const provider = createStorageProvider({ ...makeConfig(), type: 's3' });
    expect(provider).toBeInstanceOf(S3StorageProvider);
  });

  it('throws on unknown provider type', () => {
    expect(() =>
      createStorageProvider(
        // @ts-expect-error — testing invalid type
        { ...makeConfig(), type: 'gcs' },
      ),
    ).toThrow('Unknown storage provider type: "gcs"');
  });
});