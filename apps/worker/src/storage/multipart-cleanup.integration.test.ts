import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { Pool } from 'pg';
import { GenericContainer, Wait, type StartedTestContainer } from 'testcontainers';
import { S3StorageProvider, type StorageProvider } from '@barghsa/shared/storage';
import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import { runMigrations } from '../../../../packages/db/src/migrate';
import { cleanupMultipartOrphans } from './multipart-cleanup.js';
import { withMultipartUploadLock } from '@barghsa/db/storage-multipart';

const database = `test_multipart_cleanup_${randomUUID().replaceAll('-', '')}`;
const requireShared = createRequire(resolve(__dirname, '../../../../packages/shared/package.json'));
const sdk = requireShared('@aws-sdk/client-s3') as Record<string, new (input: object) => object>;
let management: Pool;
let pool: Pool;
let minio: StartedTestContainer;
let provider: S3StorageProvider;

beforeAll(async () => {
  management = new Pool({ connectionString: process.env.TEST_DATABASE_URL! });
  await management.query(`CREATE DATABASE "${database}"`);
  const url = new URL(process.env.TEST_DATABASE_URL!);
  url.pathname = `/${database}`;
  const migrated = await runMigrations({ connection: { pgdirectUrl: url.toString() } });
  if (!migrated.ok) throw new Error(JSON.stringify(migrated));
  pool = new Pool({ connectionString: url.toString() });
  minio = await new GenericContainer(
    'pgsty/minio@sha256:b6bfe7239bfc83fb90d31612d9704d86039dd714f7904b3f1ad68f211e602372'
  )
    .withEnvironment({ MINIO_ROOT_USER: 'test-only-key', MINIO_ROOT_PASSWORD: 'test-only-secret' })
    .withCommand(['server', '/data'])
    .withExposedPorts(9000)
    .withWaitStrategy(Wait.forHttp('/minio/health/ready', 9000))
    .start();
  const endpoint = `http://${minio.getHost()}:${minio.getMappedPort(9000)}`;
  const client = new sdk['S3Client']!({
    endpoint,
    region: 'us-east-1',
    forcePathStyle: true,
    credentials: { accessKeyId: 'test-only-key', secretAccessKey: 'test-only-secret' },
  }) as { send(command: object): Promise<unknown>; destroy(): void };
  await client.send(new sdk['CreateBucketCommand']!({ Bucket: 'multipart-cleanup-test' }));
  client.destroy();
  provider = new S3StorageProvider({
    bucket: 'multipart-cleanup-test',
    endpoint,
    region: 'us-east-1',
    forcePathStyle: true,
    accessKeyId: 'test-only-key',
    secretAccessKey: 'test-only-secret',
  });
}, 60_000);
afterAll(async () => {
  provider?.destroy();
  await pool?.end();
  await minio?.stop();
  await management?.query(`DROP DATABASE "${database}"`);
  await management?.end();
});

it('honors the configured age, aborts a provider upload and records its outcome', async () => {
  const key = `uploads/document/${randomUUID()}.pdf`;
  const providerId = await provider.createMultipartUpload(key, 'application/pdf');
  await pool.query(
    `INSERT INTO storage_records(storage_key,status,metadata,removed_at)
     VALUES($1,'removed',$2::jsonb,NOW())`,
    [key, JSON.stringify({ multipart: { id: randomUUID(), providerId, status: 'in_progress' } })]
  );
  const future = new Date(Date.now() + 2 * 3600_000);
  expect(await cleanupMultipartOrphans(pool, provider, future)).toMatchObject({
    scanned: 1,
    aborted: 0,
    failed: 0,
  });
  await pool.query(
    `INSERT INTO app_config(key,value) VALUES('storage.multipart_orphan_hours','{"hours":1}'::jsonb)`
  );
  expect(await cleanupMultipartOrphans(pool, provider, future)).toMatchObject({
    scanned: 1,
    aborted: 1,
    failed: 0,
  });
  expect((await provider.listMultipartUploads('uploads/')).uploads).toEqual([]);
  expect(
    (
      await pool.query('SELECT status,error_code FROM upload_cleanup_log WHERE storage_key=$1', [
        key,
      ])
    ).rows[0]
  ).toMatchObject({ status: 'aborted', error_code: null });
  expect(
    (await pool.query('SELECT metadata FROM storage_records WHERE storage_key=$1', [key])).rows[0]
      .metadata.multipart.status
  ).toBe('aborted');
});

it('stops before provider calls when the saved cleanup age is invalid', async () => {
  const saved = (
    await pool.query("SELECT value FROM app_config WHERE key='storage.multipart_orphan_hours'")
  ).rows[0];
  const list = vi.spyOn(provider, 'listMultipartUploads');
  const abort = vi.spyOn(provider, 'abortMultipartUpload');
  try {
    for (const invalid of [{}, null, { hours: null }, { hours: '1' }, { hours: 0 }]) {
      await pool.query(
        `INSERT INTO app_config(key,value) VALUES('storage.multipart_orphan_hours',$1::jsonb)
         ON CONFLICT(key) DO UPDATE SET value=EXCLUDED.value`,
        [JSON.stringify(invalid)]
      );
      await expect(cleanupMultipartOrphans(pool, provider)).rejects.toThrow(
        'Invalid multipart orphan cleanup policy'
      );
    }
    expect(list).not.toHaveBeenCalled();
    expect(abort).not.toHaveBeenCalled();
  } finally {
    list.mockRestore();
    abort.mockRestore();
    if (saved)
      await pool.query(
        "UPDATE app_config SET value=$1::jsonb WHERE key='storage.multipart_orphan_hours'",
        [JSON.stringify(saved.value)]
      );
    else await pool.query("DELETE FROM app_config WHERE key='storage.multipart_orphan_hours'");
  }
});

it('records a provider failure and retries the same upload on a later scan', async () => {
  const key = `uploads/document/${randomUUID()}.pdf`;
  await provider.createMultipartUpload(key, 'application/pdf');
  const abort = vi
    .fn()
    .mockRejectedValueOnce(new Error('provider unavailable'))
    .mockImplementation((targetKey: string, uploadId: string) =>
      provider.abortMultipartUpload(targetKey, uploadId)
    );
  const storage = {
    listMultipartUploads: provider.listMultipartUploads.bind(provider),
    abortMultipartUpload: abort,
  } as unknown as StorageProvider;
  const future = new Date(Date.now() + 2 * 3600_000);
  expect(await cleanupMultipartOrphans(pool, storage, future)).toMatchObject({ failed: 1 });
  expect(
    (
      await pool.query('SELECT status,error_code FROM upload_cleanup_log WHERE storage_key=$1', [
        key,
      ])
    ).rows[0]
  ).toMatchObject({ status: 'failed', error_code: 'provider_abort_failed' });
  expect(await cleanupMultipartOrphans(pool, storage, future)).toMatchObject({ aborted: 1 });
  expect(abort).toHaveBeenCalledTimes(2);
  expect(
    (
      await pool.query('SELECT status,error_code FROM upload_cleanup_log WHERE storage_key=$1', [
        key,
      ])
    ).rows[0]
  ).toMatchObject({ status: 'aborted', error_code: null });
});

it('does not abort a session already completed in the database', async () => {
  const key = `uploads/document/${randomUUID()}.pdf`;
  const providerId = await provider.createMultipartUpload(key, 'application/pdf');
  await pool.query(
    `INSERT INTO storage_records(storage_key,status,metadata,removed_at)
     VALUES($1,'removed',$2::jsonb,NOW())`,
    [key, JSON.stringify({ multipart: { id: randomUUID(), providerId, status: 'completed' } })]
  );
  expect(
    await cleanupMultipartOrphans(pool, provider, new Date(Date.now() + 2 * 3600_000))
  ).toMatchObject({
    aborted: 0,
    failed: 0,
  });
  expect((await provider.listMultipartUploads(key)).uploads).toHaveLength(1);
  expect(
    (await pool.query('SELECT id FROM upload_cleanup_log WHERE storage_key=$1', [key])).rows
  ).toHaveLength(0);
  await provider.abortMultipartUpload(key, providerId);
});

it('uses provider continuation markers after filtered pages and refuses a cycle without claiming cleanup', async () => {
  const before = (
    await pool.query("SELECT value FROM app_config WHERE key='storage.multipart_cleanup_cursor'")
  ).rows[0]?.value;
  const list = vi.fn().mockResolvedValue({
    uploads: [],
    isTruncated: true,
    nextKeyMarker: 'filtered-key',
    nextUploadIdMarker: 'filtered-id',
  });
  const abort = vi.fn();
  const storage = {
    listMultipartUploads: list,
    abortMultipartUpload: abort,
  } as unknown as StorageProvider;
  await expect(cleanupMultipartOrphans(pool, storage)).rejects.toThrow('did not advance');
  expect(list).toHaveBeenCalledTimes(2);
  expect(list.mock.calls[1]).toEqual(['', 100, 'filtered-key', 'filtered-id']);
  expect(abort).not.toHaveBeenCalled();
  expect(
    (await pool.query("SELECT value FROM app_config WHERE key='storage.multipart_cleanup_cursor'"))
      .rows[0]?.value
  ).toEqual(before);
  list.mockReset().mockResolvedValue({ uploads: [], isTruncated: false });
  expect(await cleanupMultipartOrphans(pool, storage)).toEqual({
    scanned: 0,
    aborted: 0,
    failed: 0,
    busy: false,
  });
});

it('advances to the actual provider marker rather than the last normalized upload', async () => {
  const recent = { key: 'normalized-key', uploadId: 'normalized-id', initiatedAt: new Date() };
  const list = vi
    .fn()
    .mockResolvedValueOnce({
      uploads: [recent],
      isTruncated: true,
      nextKeyMarker: 'last-provider-key',
      nextUploadIdMarker: 'last-provider-id',
    })
    .mockResolvedValueOnce({ uploads: [], isTruncated: false });
  const abort = vi.fn();
  const storage = {
    listMultipartUploads: list,
    abortMultipartUpload: abort,
  } as unknown as StorageProvider;
  expect(await cleanupMultipartOrphans(pool, storage)).toMatchObject({
    scanned: 1,
    aborted: 0,
    failed: 0,
  });
  expect(list.mock.calls[1]).toEqual(['', 100, 'last-provider-key', 'last-provider-id']);
  expect(abort).not.toHaveBeenCalled();
});

it('bounds advancing empty pages and checkpoints the provider cursor for the next run', async () => {
  let page = 0;
  const list = vi.fn(async () => ({
    uploads: [],
    isTruncated: true,
    nextKeyMarker: `key-${++page}`,
    nextUploadIdMarker: `id-${page}`,
  }));
  const abort = vi.fn();
  const storage = {
    listMultipartUploads: list,
    abortMultipartUpload: abort,
  } as unknown as StorageProvider;
  expect(await cleanupMultipartOrphans(pool, storage)).toEqual({
    scanned: 0,
    aborted: 0,
    failed: 0,
    busy: false,
  });
  expect(list).toHaveBeenCalledTimes(5);
  expect(abort).not.toHaveBeenCalled();
  expect(
    (await pool.query("SELECT value FROM app_config WHERE key='storage.multipart_cleanup_cursor'"))
      .rows[0]?.value
  ).toEqual({ keyMarker: 'key-5', uploadIdMarker: 'id-5' });
});

async function pendingCompletion() {
  await pool.query("DELETE FROM app_config WHERE key='storage.multipart_cleanup_cursor'");
  const key = `uploads/document/${randomUUID()}.pdf`;
  const providerId = await provider.createMultipartUpload(key, 'application/pdf');
  const bytes = Buffer.alloc(5 * 1024 * 1024 + 17, 65);
  for (let number = 1; number <= 2; number++) {
    const url = await provider.presignedUploadPartUrl(key, providerId, number);
    const start = (number - 1) * 5 * 1024 * 1024;
    expect(
      (await fetch(url, { method: 'PUT', body: bytes.subarray(start, start + 5 * 1024 * 1024) }))
        .status
    ).toBe(200);
  }
  const parts = await provider.listMultipartParts(key, providerId);
  await pool.query(
    `INSERT INTO storage_records(storage_key,file_size,content_type,status,metadata,removed_at)
     VALUES($1,$2,'application/pdf','removed',$3::jsonb,NOW())`,
    [
      key,
      bytes.length,
      JSON.stringify({
        multipart: { id: randomUUID(), providerId, status: 'completing', parts },
        provisionalUpload: true,
        deletionRequested: true,
        uploadExpiresAt: new Date(Date.now() - 3600000).toISOString(),
      }),
    ]
  );
  return { key, providerId, parts, bytes };
}

it('keeps a completing upload out of orphan cleanup while another session owns its operation', async () => {
  const upload = await pendingCompletion();
  let entered!: () => void, release!: () => void;
  const started = new Promise<void>((resolve) => {
    entered = resolve;
  });
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const held = withMultipartUploadLock(pool, upload.key, async () => {
    entered();
    await gate;
  });
  await started;
  const abort = vi.spyOn(provider, 'abortMultipartUpload');
  try {
    expect(
      await cleanupMultipartOrphans(pool, provider, new Date(Date.now() + 2 * 3600000))
    ).toMatchObject({ aborted: 0, failed: 0 });
    expect(abort).not.toHaveBeenCalled();
    expect(
      (await pool.query('SELECT metadata FROM storage_records WHERE storage_key=$1', [upload.key]))
        .rows[0].metadata.multipart.status
    ).toBe('completing');
  } finally {
    release();
    await held;
    abort.mockRestore();
  }
  expect(await cleanupMultipartOrphans(pool, provider)).toMatchObject({ completed: 1, failed: 0 });
  await provider.deleteObject(upload.key);
});

it('reconciles a completion that succeeded before its database receipt, even after reservation expiry', async () => {
  const upload = await pendingCompletion();
  await pool.query(
    'UPDATE storage_records SET metadata=metadata||\'{"deletionRequested":false}\'::jsonb WHERE storage_key=$1',
    [upload.key]
  );
  await provider.completeMultipartUpload(upload.key, upload.providerId, upload.parts);
  expect((await provider.listMultipartUploads(upload.key)).uploads).toEqual([]);
  expect(await cleanupMultipartOrphans(pool, provider)).toMatchObject({ completed: 1, failed: 0 });
  expect(
    (await pool.query('SELECT metadata FROM storage_records WHERE storage_key=$1', [upload.key]))
      .rows[0].metadata.multipart.status
  ).toBe('completed');
  expect(
    (await pool.query('SELECT metadata FROM storage_records WHERE storage_key=$1', [upload.key]))
      .rows[0].metadata.deletionRequested
  ).toBe(true);
  expect(
    (await pool.query('SELECT * FROM upload_cleanup_log WHERE storage_key=$1', [upload.key])).rows
  ).toEqual([]);
  const object = await provider.getObject(upload.key);
  expect(object.contentLength).toBe(upload.bytes.length);
  await object.body.cancel();
  await provider.deleteObject(upload.key);
});

it('retains a failed completion with a retry reason and retries once on a later pass', async () => {
  const upload = await pendingCompletion();
  const complete = vi
    .spyOn(provider, 'completeMultipartUpload')
    .mockRejectedValue(new Error('provider unavailable'));
  try {
    expect(
      await cleanupMultipartOrphans(pool, provider, new Date(Date.now() + 2 * 3600000))
    ).toMatchObject({ aborted: 0, failed: 1 });
    expect(complete).toHaveBeenCalledOnce();
    const state = (
      await pool.query('SELECT metadata FROM storage_records WHERE storage_key=$1', [upload.key])
    ).rows[0].metadata.multipart;
    expect(state).toMatchObject({
      status: 'completing',
      lastErrorCode: 'completion_retry_required',
    });
  } finally {
    complete.mockRestore();
  }
  expect(await cleanupMultipartOrphans(pool, provider)).toMatchObject({ completed: 1, failed: 0 });
  await provider.deleteObject(upload.key);
});

for (const registered of [false, true]) {
  it(`recovers an abort response lost after S3 removed the upload (${registered ? 'registered' : 'orphan'})`, async () => {
    await pool.query("DELETE FROM app_config WHERE key='storage.multipart_cleanup_cursor'");
    const key = `uploads/document/${randomUUID()}.pdf`;
    const providerId = await provider.createMultipartUpload(key, 'application/pdf');
    if (registered)
      await pool.query(
        `INSERT INTO storage_records(storage_key,status,metadata) VALUES($1,'removed',$2::jsonb)`,
        [
          key,
          JSON.stringify({ multipart: { id: randomUUID(), providerId, status: 'in_progress' } }),
        ]
      );
    const original = provider.abortMultipartUpload.bind(provider);
    const abort = vi
      .spyOn(provider, 'abortMultipartUpload')
      .mockImplementationOnce(async (target, id) => {
        expect(
          (await pool.query('SELECT status FROM upload_cleanup_log WHERE storage_key=$1', [key]))
            .rows
        ).toEqual([{ status: 'pending' }]);
        const observer = await pool.connect();
        try {
          await observer.query('BEGIN');
          await observer.query(
            'SELECT 1 FROM storage_records WHERE storage_key=$1 FOR UPDATE NOWAIT',
            [key]
          );
          await observer.query('COMMIT');
        } finally {
          await observer.query('ROLLBACK');
          observer.release();
        }
        await original(target, id);
        throw new Error('response lost');
      });
    try {
      const future = new Date(Date.now() + 2 * 3600000);
      expect(await cleanupMultipartOrphans(pool, provider, future)).toMatchObject({ failed: 1 });
      expect((await provider.listMultipartUploads(key)).uploads).toEqual([]);
      expect(await cleanupMultipartOrphans(pool, provider, future)).toMatchObject({
        aborted: 1,
        failed: 0,
      });
      expect(
        (
          await pool.query(
            'SELECT status,error_code FROM upload_cleanup_log WHERE storage_key=$1',
            [key]
          )
        ).rows
      ).toEqual([{ status: 'aborted', error_code: null }]);
      expect(abort).toHaveBeenCalledTimes(2);
    } finally {
      abort.mockRestore();
    }
  });
}

it('keeps protected historical failures from starving a later orphan recovery', async () => {
  await pool.query("DELETE FROM app_config WHERE key='storage.multipart_cleanup_cursor'");
  const protectedKeys = Array.from({ length: 25 }, () => `protected/${randomUUID()}`);
  for (const key of protectedKeys) {
    await pool.query("INSERT INTO storage_records(storage_key,status) VALUES($1,'active')", [key]);
    await pool.query(
      `INSERT INTO upload_cleanup_log(storage_key,provider_upload_id,initiated_at,status,recorded_at) VALUES($1,'retained',NOW()-INTERVAL '2 days','failed',NOW()-INTERVAL '1 day')`,
      [key]
    );
  }
  const key = `uploads/document/${randomUUID()}.pdf`;
  const providerId = await provider.createMultipartUpload(key, 'application/pdf');
  await provider.abortMultipartUpload(key, providerId);
  await pool.query(
    `INSERT INTO upload_cleanup_log(storage_key,provider_upload_id,initiated_at,status,recorded_at) VALUES($1,$2,NOW(),'pending',NOW()-INTERVAL '2 minutes')`,
    [key, providerId]
  );
  expect(await cleanupMultipartOrphans(pool, provider)).toMatchObject({ aborted: 1, failed: 0 });
  expect(
    (await pool.query('SELECT status FROM upload_cleanup_log WHERE storage_key=$1', [key])).rows
  ).toEqual([{ status: 'aborted' }]);
  expect(
    (
      await pool.query(
        "SELECT count(*)::int AS count FROM upload_cleanup_log WHERE storage_key=ANY($1::text[]) AND status='failed'",
        [protectedKeys]
      )
    ).rows[0].count
  ).toBe(25);
});
