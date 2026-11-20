import { createHash, createHmac, randomBytes, randomUUID } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createServer, type Server } from 'node:http';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { SecretCipher } from '@barghsa/shared/auth-delivery';
import {
  encryptStorageSecret,
  STORAGE_UPLOAD_WEBHOOK_PATH,
  storageWebhookReceiptContext,
} from '@barghsa/shared/storage';
import type { Pool } from 'pg';
import { afterAll, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import { startHttpFixture } from '../test/http-fixture.js';

const requireWorker = createRequire(resolve(__dirname, '../../../worker/package.json'));
const { processStorageWebhookReceipt } = requireWorker(
  './dist/storage/upload-webhook-runner.js'
) as { processStorageWebhookReceipt(pool: Pool): Promise<void> };

const key = randomBytes(32);
const bucket = 'test-evidence';
const version = '6716672bc6dce1dcbee268af1e7ff285';
const bytes = Buffer.from('%PDF-1.7 test receipt');
const objects = new Map<string, string>();
const readRequests: string[] = [];
let http: Awaited<ReturnType<typeof startHttpFixture>>;
let provider: Server;
let directory: string, keyFile: string, endpoint: string;
let beforeGet: (() => Promise<void>) | undefined;

beforeAll(async () => {
  directory = await mkdtemp(join(tmpdir(), 'storage-webhook-test-'));
  keyFile = join(directory, 'key');
  await writeFile(keyFile, key.toString('hex'), { mode: 0o600 });
  vi.stubEnv('STORAGE_WEBHOOK_SIGNING_KEY_FILE', keyFile);
  vi.stubEnv('STORAGE_CONFIG_ENCRYPTION_KEY', 'http-fixture-storage-key-only');
  provider = createServer(async (request, response) => {
    const path = decodeURIComponent(new URL(request.url!, 'http://localhost').pathname).replace(
      `/${bucket}/`,
      ''
    );
    readRequests.push(path);
    const id = objects.get(path);
    if (!id || !request.headers.authorization?.startsWith('AWS4-HMAC-SHA256 ')) {
      response.writeHead(id ? 403 : 404).end();
      return;
    }
    await beforeGet?.();
    response.writeHead(200, {
      'Content-Type': 'application/pdf',
      'Content-Length': bytes.length,
      'x-amz-version-id': id,
    });
    response.end(bytes);
  });
  await new Promise<void>((ready) => provider.listen(0, '127.0.0.1', ready));
  endpoint = `http://127.0.0.1:${(provider.address() as { port: number }).port}`;
  vi.stubEnv('S3_ALLOWED_ENDPOINT_ORIGINS', endpoint);
  http = await startHttpFixture(process.env.TEST_DATABASE_URL!, endpoint);
}, 45000);

beforeEach(async () => {
  objects.clear();
  readRequests.length = 0;
  beforeGet = undefined;
  await http.pool.query('DELETE FROM storage_webhook_events');
  await http.pool.query(
    `INSERT INTO app_config(key,value) VALUES ('storage.active',$1)
     ON CONFLICT(key) DO UPDATE SET value=EXCLUDED.value`,
    [
      {
        bucket,
        region: 'us-east-1',
        endpoint,
        privateEndpointUrl: endpoint,
        publicEndpointUrl: endpoint,
        accessKeyId: 'fixture-storage-access',
        encryptedSecret: encryptStorageSecret('fixture-storage-secret'),
        forcePathStyle: true,
      },
    ]
  );
});

afterAll(async () => {
  try {
    await http?.close();
  } finally {
    provider?.closeAllConnections();
    if (provider) await new Promise<void>((closed) => provider.close(() => closed()));
    if (directory) await rm(directory, { recursive: true, force: true });
    vi.unstubAllEnvs();
  }
});

function event(storageKey = `uploads/document/${randomUUID()}.pdf`) {
  return { event_type: 'object-created', bucket, key: storageKey, version_id: version };
}

function delivery(body: string, timestamp = String(Math.floor(Date.now() / 1000))) {
  const id = createHash('sha256').update(body).digest('hex');
  return {
    'Content-Type': 'application/json',
    'X-Barghsa-Webhook-Id': id,
    'X-Barghsa-Webhook-Timestamp': timestamp,
    'X-Barghsa-Webhook-Signature': createHmac('sha256', key)
      .update(`${id}.${timestamp}.${body}`)
      .digest('base64'),
  };
}

function submit(body: string, headers: Record<string, string> = delivery(body)) {
  return fetch(http.base + STORAGE_UPLOAD_WEBHOOK_PATH, { method: 'POST', body, headers });
}

async function reserve(storageKey: string, multipartStatus?: string) {
  await http.pool.query(
    `INSERT INTO storage_records(storage_key, status, file_size, content_type, metadata)
     VALUES ($1,'removed',$2,'application/pdf',
       $3::jsonb || jsonb_build_object('uploadExpiresAt', clock_timestamp() + interval '5 minutes'))`,
    [
      storageKey,
      bytes.length,
      {
        uploadedBy: 'receipt-fixture-owner',
        provisionalUpload: true,
        deletionRequested: true,
        ...(multipartStatus ? { multipart: { status: multipartStatus } } : {}),
      },
    ]
  );
}

async function outcomes() {
  return (
    await http.pool.query(
      'SELECT event_id, encrypted_payload, outcome, attempts FROM storage_webhook_events'
    )
  ).rows;
}

async function record(storageKey: string) {
  return (
    await http.pool.query('SELECT status, metadata FROM storage_records WHERE storage_key=$1', [
      storageKey,
    ])
  ).rows[0];
}

it('rejects missing, forged, expired, altered, malformed and wrong-bucket events', async () => {
  const raw = JSON.stringify(event());
  expect((await submit(raw, { 'Content-Type': 'application/json' })).status).toBe(401);
  expect(
    (
      await submit(raw, {
        ...delivery(raw),
        'X-Barghsa-Webhook-Signature': randomBytes(32).toString('base64'),
      })
    ).status
  ).toBe(401);
  expect(
    (await submit(raw, delivery(raw, String(Math.floor(Date.now() / 1000) - 301)))).status
  ).toBe(401);
  expect((await submit(JSON.stringify(event()), delivery(raw))).status).toBe(401);
  expect((await submit(`\uFEFF${raw}`)).status).toBe(400);
  expect((await submit(JSON.stringify({ ...event(), extra: true }))).status).toBe(400);
  expect((await submit(JSON.stringify({ ...event(), bucket: 'other-context' }))).status).toBe(401);
  expect((await submit(JSON.stringify({ extra: 'a'.repeat(600) }))).status).toBe(413);
  expect(await outcomes()).toEqual([]);
  expect(readRequests).toEqual([]);
});

it('requires the protected signing key even for a correctly formed request', async () => {
  await writeFile(keyFile, 'malformed');
  try {
    expect((await submit(JSON.stringify(event()))).status).toBe(503);
    expect(await outcomes()).toEqual([]);
  } finally {
    await writeFile(keyFile, key.toString('hex'));
  }
});

it('queues one encrypted receipt and updates only the pending observation after an authenticated read', async () => {
  const upload = event();
  await reserve(upload.key);
  objects.set(upload.key, version);
  const raw = JSON.stringify(upload);
  const headers = delivery(raw);
  const responses = await Promise.all(Array.from({ length: 4 }, () => submit(raw, headers)));
  for (const response of responses) {
    expect(response.status).toBe(202);
    expect(await response.json()).toEqual({ received: true });
  }
  const pending = await outcomes();
  expect(pending).toHaveLength(1);
  expect(pending[0]).toMatchObject({ outcome: null, attempts: 0 });
  expect(pending[0].encrypted_payload).not.toContain(upload.key);
  expect(
    new SecretCipher('STORAGE_CONFIG_ENCRYPTION_KEY').decrypt(
      pending[0].encrypted_payload,
      storageWebhookReceiptContext(pending[0].event_id)
    )
  ).toBe(raw);
  expect(readRequests).toEqual([]);

  await Promise.all([
    processStorageWebhookReceipt(http.pool),
    processStorageWebhookReceipt(http.pool),
  ]);
  expect(readRequests).toEqual([upload.key]);
  expect(await outcomes()).toEqual([expect.objectContaining({ outcome: 'observed', attempts: 1 })]);
  const storageRecord = await record(upload.key);
  expect(storageRecord).toMatchObject({
    status: 'removed',
    metadata: {
      provisionalUpload: true,
      providerObservedVersion: version,
      deletionRequested: true,
    },
  });
  expect(storageRecord.metadata.scanState).toBeUndefined();
  expect((await submit(raw, headers)).status).toBe(202);
  expect(await outcomes()).toHaveLength(1);
});

it('ignores missing reservations, deleted objects and a version that is no longer current', async () => {
  const unmatched = event(),
    changed = event(),
    deleted = event();
  await reserve(changed.key);
  await reserve(deleted.key);
  objects.set(changed.key, '6716672bc6dce1dcbee268af1e7ff286');
  expect((await submit(JSON.stringify(unmatched))).status).toBe(202);
  expect((await submit(JSON.stringify(changed))).status).toBe(202);
  expect((await submit(JSON.stringify(deleted))).status).toBe(202);
  await processStorageWebhookReceipt(http.pool);
  await processStorageWebhookReceipt(http.pool);
  await processStorageWebhookReceipt(http.pool);
  expect((await outcomes()).map((row) => row.outcome)).toEqual(['ignored', 'ignored', 'ignored']);
  expect(readRequests.sort()).toEqual([changed.key, deleted.key].sort());
  expect((await record(changed.key)).metadata.providerObservedVersion).toBeUndefined();
  expect((await record(deleted.key)).metadata.providerObservedVersion).toBeUndefined();
});

it('retries multipart completion and respects a cleanup claim that arrives during storage readback', async () => {
  const upload = event();
  await reserve(upload.key, 'completing');
  objects.set(upload.key, version);
  expect((await submit(JSON.stringify(upload))).status).toBe(202);
  await expect(processStorageWebhookReceipt(http.pool)).rejects.toThrow('will retry');
  expect(readRequests).toEqual([]);
  expect(await outcomes()).toEqual([expect.objectContaining({ outcome: null, attempts: 1 })]);
  await http.pool.query(
    `UPDATE storage_records SET metadata=jsonb_set(metadata,'{multipart,status}','"completed"')
     WHERE storage_key=$1`,
    [upload.key]
  );
  await http.pool.query('UPDATE storage_webhook_events SET available_at=clock_timestamp()');
  beforeGet = async () => {
    await http.pool.query(
      "UPDATE storage_records SET cleanup_operation='expire' WHERE storage_key=$1",
      [upload.key]
    );
  };
  await processStorageWebhookReceipt(http.pool);
  expect(await outcomes()).toEqual([expect.objectContaining({ outcome: 'ignored', attempts: 2 })]);
  expect((await record(upload.key)).metadata.providerObservedVersion).toBeUndefined();
});
