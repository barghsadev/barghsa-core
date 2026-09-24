import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { GenericContainer, Wait, type StartedTestContainer } from 'testcontainers';
import { startHttpFixture } from '../test/http-fixture.js';

const requireShared = createRequire(resolve(__dirname, '../../../../packages/shared/package.json'));
const sdk = requireShared('@aws-sdk/client-s3') as Record<string, new (input: object) => object>;
const partSize = 5 * 1024 * 1024;
let minio: StartedTestContainer;
let http: Awaited<ReturnType<typeof startHttpFixture>>;
let client: { send(command: object): Promise<unknown>; destroy(): void };
let actorHeaders: Record<string, string>;
let otherHeaders: Record<string, string>;

beforeAll(async () => {
  minio = await new GenericContainer(
    'pgsty/minio@sha256:b6bfe7239bfc83fb90d31612d9704d86039dd714f7904b3f1ad68f211e602372'
  )
    .withEnvironment({ MINIO_ROOT_USER: 'test-only-key', MINIO_ROOT_PASSWORD: 'test-only-secret' })
    .withCommand(['server', '/data'])
    .withExposedPorts(9000)
    .withWaitStrategy(Wait.forHttp('/minio/health/ready', 9000))
    .start();
  const endpoint = `http://${minio.getHost()}:${minio.getMappedPort(9000)}`;
  client = new sdk['S3Client']!({
    endpoint,
    region: 'us-east-1',
    forcePathStyle: true,
    credentials: { accessKeyId: 'test-only-key', secretAccessKey: 'test-only-secret' },
  }) as typeof client;
  await client.send(new sdk['CreateBucketCommand']!({ Bucket: 'test-evidence' }));
  http = await startHttpFixture(process.env.TEST_DATABASE_URL!, endpoint);
  for (const name of ['owner', 'other']) {
    const userId = `multipart-${name}`;
    await http.pool.query('INSERT INTO users(user_id,username,password_hash) VALUES($1,$2,$3)', [
      userId,
      `${userId}@test.local`,
      'test-only',
    ]);
    const session = randomUUID();
    const csrf = randomUUID();
    await http.pool.query(
      `INSERT INTO sessions(session_id,user_id,csrf_token,family_id,expires_at,idle_deadline)
       VALUES($1,$2,$3,$4,NOW()+INTERVAL '1 day',NOW()+INTERVAL '30 minutes')`,
      [session, userId, csrf, randomUUID()]
    );
    const headers = {
      Cookie: `barghsa_session=${session}`,
      'X-CSRF-Token': csrf,
      'Content-Type': 'application/json',
    };
    if (name === 'owner') actorHeaders = headers;
    else otherHeaders = headers;
  }
}, 60_000);
afterAll(async () => {
  await http?.close();
  client?.destroy();
  await minio?.stop();
});

function api(path: string, method: string, headers = actorHeaders, body?: object) {
  return fetch(`${http.base}${path}`, {
    method,
    headers,
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
}

async function start(size = partSize + 91) {
  const response = await api('/api/v1/files/upload/start', 'POST', actorHeaders, {
    fileName: 'large.pdf',
    contentType: 'application/pdf',
    fileSize: size,
    category: 'document',
  });
  expect(response.status, http.logs()).toBe(201);
  return (await response.json()) as {
    uploadId: string;
    key: string;
    partSize: number;
    partCount: number;
  };
}

it('resumes from provider-listed parts and completes only the authorized bytes', async () => {
  const upload = await start();
  expect(upload).toMatchObject({ partSize, partCount: 2 });
  const first = await api(`/api/v1/files/upload/${upload.uploadId}/part?partNumber=1`, 'PUT');
  expect(first.status, http.logs()).toBe(200);
  const firstUrl = ((await first.json()) as { url: string }).url;
  const bytes = Buffer.alloc(partSize + 91, 65);
  bytes.write('%PDF-1.7\n', 0);
  expect((await fetch(firstUrl, { method: 'PUT', body: bytes.subarray(0, partSize) })).status).toBe(
    200
  );
  const parts = await api(`/api/v1/files/upload/${upload.uploadId}/parts`, 'GET');
  expect(((await parts.json()) as { parts: object[] }).parts).toMatchObject([
    { partNumber: 1, size: partSize },
  ]);
  expect((await api(`/api/v1/files/upload/${upload.uploadId}/complete`, 'POST')).status).toBe(409);
  expect(
    (await api(`/api/v1/files/upload/${upload.uploadId}/parts`, 'GET', otherHeaders)).status
  ).toBe(409);
  const second = await api(`/api/v1/files/upload/${upload.uploadId}/part?partNumber=2`, 'PUT');
  expect(second.status, http.logs()).toBe(200);
  expect(
    (
      await fetch(((await second.json()) as { url: string }).url, {
        method: 'PUT',
        body: bytes.subarray(partSize),
      })
    ).status
  ).toBe(200);
  expect((await api(`/api/v1/files/upload/${upload.uploadId}/complete`, 'POST')).status).toBe(200);
  expect((await api(`/api/v1/files/upload/${upload.uploadId}/complete`, 'POST')).status).toBe(200);
  const key = encodeURIComponent(upload.key);
  const verified = await api(`/api/upload/${key}/verify`, 'POST');
  expect(verified.status, http.logs()).toBe(200);
  expect(await verified.json()).toMatchObject({ status: 'confirmed' });
  const recorded = await api(`/api/upload/${key}/record`, 'POST', actorHeaders, {
    fileName: 'large.pdf',
    fileSize: bytes.length,
  });
  expect(recorded.status, http.logs()).toBe(200);
  expect(await recorded.json()).toMatchObject({ status: 'recorded' });
});

it('aborts an owned upload and refuses later part URLs', async () => {
  const upload = await start();
  expect((await api(`/api/v1/files/upload/${upload.uploadId}/abort`, 'POST')).status).toBe(200);
  expect(
    (await api(`/api/v1/files/upload/${upload.uploadId}/part?partNumber=1`, 'PUT')).status
  ).toBe(409);
});
