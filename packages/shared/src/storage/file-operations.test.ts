import { afterEach, expect, it, vi } from 'vitest';
import { Readable } from 'node:stream';
import { S3StorageProvider } from './s3-storage-provider.js';
import { StorageBatchDeleteError, StorageProviderError } from './storage-provider.js';
import type { S3Client } from '@aws-sdk/client-s3';

const providers: S3StorageProvider[] = [];
function fixture() {
  const provider = new S3StorageProvider({
    bucket: 'test-bucket',
    region: 'us-east-1',
    prefix: 'tenant/',
    endpoint: 'http://localhost:9000',
    accessKeyId: 'test',
    secretAccessKey: 'test',
    forcePathStyle: true,
    maxRetries: 0,
  });
  providers.push(provider);
  const send = vi.spyOn((provider as unknown as { client: S3Client }).client, 'send');
  return { provider, send };
}
afterEach(() => {
  providers.splice(0).forEach((p) => p.destroy());
  vi.restoreAllMocks();
});
function web(bytes: Uint8Array) {
  return new ReadableStream<Uint8Array>({
    start(c) {
      c.enqueue(bytes);
      c.close();
    },
  });
}

it.each(['node', 'web'] as const)(
  'uploads exact UTF-8 bytes with MIME, size and a confirmed receipt: %s',
  async (kind) => {
    const { provider, send } = fixture();
    send.mockResolvedValue({ ETag: '"confirmed"' } as never);
    const bytes = Buffer.from('برقسا');
    expect(
      await provider.upload(
        kind === 'node' ? Readable.from(['برقسا']) : web(bytes),
        'proof',
        'text/plain',
        bytes.length
      )
    ).toEqual({ key: 'proof', etag: '"confirmed"' });
    expect((send.mock.calls[0]![0] as { input: unknown }).input).toMatchObject({
      Bucket: 'test-bucket',
      Key: 'tenant/proof',
      ContentType: 'text/plain',
      ContentLength: bytes.length,
      Body: bytes,
    });
  }
);
it.each([2, 4])(
  'refuses mismatched declared stream size before creating an object: %s',
  async (size) => {
    const { provider, send } = fixture();
    await expect(
      provider.upload(web(Buffer.from('abc')), 'proof', 'text/plain', size)
    ).rejects.toThrow(StorageProviderError);
    expect(send).not.toHaveBeenCalled();
  }
);
it('refuses invalid upload input and an absent receipt rather than claiming success', async () => {
  const { provider, send } = fixture();
  for (const size of [-1, 1.5, Number.NaN, Number.MAX_SAFE_INTEGER + 1])
    await expect(
      provider.upload(web(new Uint8Array()), 'proof', 'text/plain', size)
    ).rejects.toThrow('Invalid upload');
  expect(send).not.toHaveBeenCalled();
  send.mockResolvedValue({} as never);
  await expect(provider.upload(web(new Uint8Array()), 'empty', 'text/plain', 0)).rejects.toThrow(
    'not confirmed'
  );
});
it('downloads a Node readable and cancels the source when the consumer destroys it', async () => {
  const { provider, send } = fixture();
  const cancel = vi.fn();
  const body = new ReadableStream<Uint8Array>({
    start(c) {
      c.enqueue(Buffer.from('bytes'));
    },
    cancel,
  });
  send.mockResolvedValue({ Body: { transformToWebStream: () => body } } as never);
  const result = await provider.download('proof');
  expect(result).toBeInstanceOf(Readable);
  result.destroy();
  await new Promise<void>((resolve) => result.on('close', resolve));
  expect(cancel).toHaveBeenCalledTimes(1);
});
it('returns signed methods and required write-once headers and refuses unsupported operations', async () => {
  const { provider } = fixture();
  const put = await provider.getSignedUrl('proof', 'upload');
  expect(put).toMatchObject({ method: 'PUT', headers: { 'If-None-Match': '*' } });
  expect(new URL(put.url).searchParams.get('X-Amz-Expires')).toBe('900');
  expect(new URL(put.url).searchParams.get('X-Amz-SignedHeaders')).toContain('if-none-match');
  expect(await provider.getSignedUrl('proof', 'download', 300)).toMatchObject({
    method: 'GET',
    headers: {},
  });
  await expect(provider.getSignedUrl('proof', 'delete' as 'download')).rejects.toThrow(
    'Unsupported'
  );
});
it('copies only the scoped source and destination with encoded special characters and a confirmed receipt', async () => {
  const { provider, send } = fixture();
  send.mockResolvedValue({ CopyObjectResult: { ETag: '"copy"' } } as never);
  await provider.copy('a #?%/فایل.txt', 'copy');
  expect((send.mock.calls[0]![0] as { input: unknown }).input).toEqual({
    Bucket: 'test-bucket',
    Key: 'tenant/copy',
    CopySource: 'test-bucket/tenant/a%20%23%3F%25/%D9%81%D8%A7%DB%8C%D9%84.txt',
  });
  send.mockResolvedValue({} as never);
  await expect(provider.copy('source', 'target')).rejects.toThrow('not confirmed');
  await expect(provider.copy('source', 'source')).rejects.toThrow('distinct');
});
it('distinguishes missing objects from access, configuration and transport failures without downloading bytes', async () => {
  const { provider, send } = fixture();
  send.mockResolvedValue({} as never);
  expect(await provider.objectExists('proof')).toBe(true);
  expect(send.mock.calls[0]![0].constructor.name).toBe('HeadObjectCommand');
  for (const error of [
    { name: 'NotFound', $metadata: { httpStatusCode: 404 } },
    { name: 'NoSuchKey' },
  ]) {
    send.mockRejectedValue(error);
    expect(await provider.objectExists('missing')).toBe(false);
  }
  for (const error of [
    { name: 'AccessDenied', $metadata: { httpStatusCode: 403 } },
    { name: 'NoSuchBucket', $metadata: { httpStatusCode: 404 } },
    new Error('timeout'),
  ]) {
    send.mockRejectedValue(error);
    await expect(provider.objectExists('proof')).rejects.toThrow(StorageProviderError);
  }
});
it('deduplicates and chunks logical deletes at 1000 scoped keys without removing versions', async () => {
  const { provider, send } = fixture();
  send.mockImplementation(
    async (command) =>
      ({
        Deleted: (command as { input: { Delete: { Objects: unknown[] } } }).input.Delete.Objects,
      }) as never
  );
  await provider.deleteObjects([]);
  expect(send).not.toHaveBeenCalled();
  const keys = Array.from({ length: 1001 }, (_, n) => `key-${n}`);
  await provider.deleteObjects([...keys, keys[0]!]);
  expect(send).toHaveBeenCalledTimes(2);
  const inputs = send.mock.calls.map(
    ([command]) =>
      (command as { input: { Delete: { Objects: { Key: string; VersionId?: string }[] } } }).input
  );
  expect(inputs.map((input) => input.Delete.Objects.length)).toEqual([1000, 1]);
  expect(
    inputs
      .flatMap((input) => input.Delete.Objects)
      .every((o) => o.Key.startsWith('tenant/') && o.VersionId === undefined)
  ).toBe(true);
  await expect(provider.deleteObjects([''])).rejects.toThrow('nonempty');
});
it('retains partial and missing acknowledgments and stops before further delete chunks', async () => {
  const { provider, send } = fixture();
  const keys = Array.from({ length: 1001 }, (_, n) => `key-${n}`);
  send.mockResolvedValue({
    Deleted: [{ Key: 'tenant/key-0' }],
    Errors: [{ Key: 'tenant/key-1', Code: 'AccessDenied' }],
  } as never);
  const error = await provider.deleteObjects(keys).catch((e: unknown) => e);
  expect(error).toBeInstanceOf(StorageBatchDeleteError);
  expect(error).toMatchObject({
    deletedKeys: ['key-0'],
    failedKeys: [{ key: 'key-1', code: 'AccessDenied' }],
    unconfirmedKeys: keys.slice(2),
  });
  expect(send).toHaveBeenCalledTimes(1);
});
it('preserves earlier confirmations while a later transport failure remains uncertain', async () => {
  const { provider, send } = fixture();
  const keys = Array.from({ length: 1001 }, (_, n) => `key-${n}`);
  send.mockResolvedValueOnce({
    Deleted: keys.slice(0, 1000).map((key) => ({ Key: `tenant/${key}` })),
  } as never);
  const cause = new Error('synthetic disconnect');
  send.mockRejectedValueOnce(cause);
  await expect(provider.deleteObjects(keys)).rejects.toMatchObject({
    deletedKeys: keys.slice(0, 1000),
    failedKeys: [],
    unconfirmedKeys: keys.slice(1000),
    cause,
  });
});
