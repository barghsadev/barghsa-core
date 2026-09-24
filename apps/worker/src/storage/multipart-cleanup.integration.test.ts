import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { Pool } from 'pg';
import { GenericContainer, Wait, type StartedTestContainer } from 'testcontainers';
import { S3StorageProvider, type StorageProvider } from '@barghsa/shared/storage';
import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import { runMigrations } from '../../../../packages/db/src/migrate';
import { cleanupMultipartOrphans } from './multipart-cleanup.js';

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
