import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { createServer, request as forwardRequest } from 'node:http';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { GenericContainer, Wait, type StartedTestContainer } from 'testcontainers';
import { ErrorCodes } from '@barghsa/shared/errors';
import { startHttpFixture } from '../test/http-fixture.js';

const requireShared = createRequire(resolve(__dirname, '../../../../packages/shared/package.json'));
const sdk = requireShared('@aws-sdk/client-s3') as Record<string, new (input: object) => object>;
const partSize = 5 * 1024 * 1024;
let minio: StartedTestContainer;
let http: Awaited<ReturnType<typeof startHttpFixture>>;
let client: { send(command: object): Promise<unknown>; destroy(): void };
let actorHeaders: Record<string, string>;
let otherHeaders: Record<string, string>;
let storageProxy: ReturnType<typeof createServer>;
let pausedStorage:
  | { method: string; query: string; enter(): void; gate: Promise<void>; release(): void }
  | undefined;

function pauseStorage(method: string, query: string) {
  let enter!: () => void, unblock!: () => void;
  const entered = new Promise<void>((resolve) => {
    enter = resolve;
  });
  const gate = new Promise<void>((resolve) => {
    unblock = resolve;
  });
  const pause = { method, query, enter, gate, release: unblock };
  pausedStorage = pause;
  return {
    entered,
    release() {
      if (pausedStorage === pause) pausedStorage = undefined;
      unblock();
    },
  };
}

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
  storageProxy = createServer(async (req, res) => {
    const pause = pausedStorage;
    if (
      pause &&
      req.method === pause.method &&
      new URL(req.url!, 'http://fixture').searchParams.has(pause.query)
    ) {
      pause.enter();
      await pause.gate;
    }
    const upstream = forwardRequest(
      new URL(req.url!, endpoint),
      { method: req.method, headers: req.headers },
      (response) => {
        res.writeHead(response.statusCode!, response.headers);
        response.pipe(res);
      }
    );
    upstream.on('error', () => {
      res.destroy();
    });
    req.pipe(upstream);
  });
  await new Promise<void>((resolve) => storageProxy.listen(0, '127.0.0.1', resolve));
  const address = storageProxy.address();
  if (!address || typeof address === 'string') throw new Error('Storage proxy has no TCP address');
  http = await startHttpFixture(process.env.TEST_DATABASE_URL!, `http://127.0.0.1:${address.port}`);
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
  pausedStorage?.release();
  await http?.close();
  if (storageProxy)
    await new Promise<void>((resolve, reject) =>
      storageProxy.close((error) => (error ? reject(error) : resolve()))
    );
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

async function start(size = partSize + 91, profileId?: string) {
  const response = await api('/api/v1/files/upload/start', 'POST', actorHeaders, {
    fileName: 'large.pdf',
    contentType: 'application/pdf',
    fileSize: size,
    category: 'document',
    ...(profileId ? { profileId, purpose: 'bank_receipt' } : {}),
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

it('rejects extra multipart command fields before changing the reservation', async () => {
  const upload = await start();
  const path = `/api/v1/files/upload/${upload.uploadId}`;
  const read = async () =>
    (await http.pool.query('SELECT * FROM storage_records WHERE storage_key=$1', [upload.key]))
      .rows[0];
  const before = await read();
  const commands = [
    ['PUT', 'part?partNumber=1'],
    ['POST', 'complete'],
    ['POST', 'abort'],
  ] as const;
  for (const [method, action] of commands) {
    const response = await api(`${path}/${action}`, method, actorHeaders, { unexpected: true });
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: ErrorCodes.VALIDATION_INPUT_INVALID.code },
    });
    expect(await read()).toEqual(before);
  }
  expect((await api(`${path}/part?partNumber=1`, 'PUT', actorHeaders, {})).status).toBe(200);
  expect((await api(`${path}/complete`, 'POST', actorHeaders, {})).status).toBe(409);
  expect((await api(`${path}/abort`, 'POST', actorHeaders, {})).status).toBe(200);
});

it('aborts an owned upload and refuses later part URLs', async () => {
  const upload = await start();
  expect((await api(`/api/v1/files/upload/${upload.uploadId}/abort`, 'POST')).status).toBe(200);
  expect(
    (await api(`/api/v1/files/upload/${upload.uploadId}/part?partNumber=1`, 'PUT')).status
  ).toBe(409);
});

it('rechecks the reservation profile before disclosing or completing an upload', async () => {
  const profile = (
    await http.pool.query(
      "INSERT INTO profiles(user_id,profile_type,status) VALUES ('multipart-other','LEGAL','ACTIVE') RETURNING id"
    )
  ).rows[0];
  await http.pool.query(
    "INSERT INTO profile_agents(profile_id,user_id,role) VALUES ($1,'multipart-owner','Finance')",
    [profile.id]
  );
  const direct = await api('/api/upload/presigned-url', 'POST', actorHeaders, {
    fileName: 'receipt.pdf',
    contentType: 'application/pdf',
    fileSize: 128,
    category: 'document',
    purpose: 'bank_receipt',
    profileId: profile.id,
  });
  expect(direct.status, http.logs()).toBe(200);
  const key = encodeURIComponent(((await direct.json()) as { key: string }).key);
  const verify = await api(`/api/upload/${key}/verify`, 'POST');
  expect(verify.status, http.logs()).toBe(200);
  expect(await verify.json()).toMatchObject({ status: 'not_found' });

  const upload = await start(partSize + 91, profile.id);
  const path = `/api/v1/files/upload/${upload.uploadId}`;
  expect((await api(`${path}/part?partNumber=1`, 'PUT')).status, http.logs()).toBe(200);
  const pause = pauseStorage('GET', 'uploadId');
  const pending = api(`${path}/parts`, 'GET');
  try {
    await Promise.race([
      pause.entered,
      pending.then((response) => {
        throw new Error(`Expected provider list request, got ${response.status}`);
      }),
    ]);
    await http.pool.query(
      "DELETE FROM profile_agents WHERE profile_id=$1 AND user_id='multipart-owner'",
      [profile.id]
    );
  } finally {
    pause.release();
  }
  const listed = await pending;
  expect(listed.status, http.logs()).toBe(404);
  expect(await listed.json()).not.toHaveProperty('parts');
  expect((await api(`${path}/part?partNumber=1`, 'PUT')).status).toBe(404);
  expect((await api(`${path}/complete`, 'POST')).status).toBe(404);
  expect((await api(`/api/upload/${key}/verify`, 'POST')).status).toBe(404);
  expect((await api(`/api/upload/${key}/record`, 'POST', actorHeaders, {})).status).toBe(404);
  expect((await api(`${path}/abort`, 'POST', otherHeaders)).status).toBe(409);
  expect((await api(`${path}/abort`, 'POST')).status).toBe(200);
});

it('commits the document and its idempotent reservation before initializing S3', async () => {
  const profile = (
    await http.pool.query(
      "INSERT INTO profiles(user_id,profile_type,is_default) VALUES('multipart-owner','LEGAL',true) RETURNING id"
    )
  ).rows[0].id;
  await http.pool.query(
    "UPDATE sessions SET step_up_verified_at=NOW()-INTERVAL '1 second' WHERE user_id='multipart-owner'"
  );
  const body = {
    profileId: profile,
    businessRecordType: 'standalone',
    category: 'document',
    fileName: 'committed.pdf',
    contentType: 'application/pdf',
    fileSize: partSize + 91,
    idempotencyKey: randomUUID(),
  };
  const pause = pauseStorage('POST', 'uploads');
  const pending = api('/api/documents', 'POST', actorHeaders, body);
  await Promise.race([
    pause.entered,
    pending.then((response) => {
      throw new Error(`Request completed before S3: ${response.status}`);
    }),
  ]);
  try {
    const documents = await http.pool.query(
      "SELECT upload_key FROM documents WHERE profile_id=$1 AND original_name='committed.pdf'",
      [profile]
    );
    expect(documents.rows).toHaveLength(1);
    expect(
      (
        await http.pool.query('SELECT metadata FROM storage_records WHERE storage_key=$1', [
          documents.rows[0].upload_key,
        ])
      ).rows[0].metadata.multipart.status
    ).toBe('starting');
  } finally {
    pause.release();
  }
  const created = await pending;
  expect(created.status, http.logs()).toBe(201);
  const result = (await created.json()) as {
    document: { id: string };
    upload: { uploadId: string; key: string };
  };
  const replay = await api('/api/documents', 'POST', actorHeaders, body);
  expect(replay.status, http.logs()).toBe(201);
  expect(await replay.json()).toMatchObject({
    document: { id: result.document.id },
    upload: result.upload,
  });
  expect(
    (
      await http.pool.query(
        "SELECT id FROM documents WHERE profile_id=$1 AND original_name='committed.pdf'",
        [profile]
      )
    ).rows
  ).toHaveLength(1);
});

it('commits completion intent without a row lock and rejects a competing abort or premature verification', async () => {
  const upload = await start();
  for (let number = 1; number <= 2; number++) {
    const signed = await api(
      `/api/v1/files/upload/${upload.uploadId}/part?partNumber=${number}`,
      'PUT'
    );
    expect(signed.status, http.logs()).toBe(200);
    expect(
      (
        await fetch(((await signed.json()) as { url: string }).url, {
          method: 'PUT',
          body: Buffer.alloc(number === 1 ? partSize : 91, 65),
        })
      ).status
    ).toBe(200);
  }
  const pause = pauseStorage('POST', 'uploadId');
  const pending = api(`/api/v1/files/upload/${upload.uploadId}/complete`, 'POST');
  await pause.entered;
  const observer = await http.pool.connect();
  try {
    await observer.query('BEGIN');
    const state = await observer.query(
      'SELECT metadata FROM storage_records WHERE storage_key=$1 FOR UPDATE NOWAIT',
      [upload.key]
    );
    expect(state.rows[0].metadata.multipart.status).toBe('completing');
    await observer.query('COMMIT');
    expect((await api(`/api/v1/files/upload/${upload.uploadId}/abort`, 'POST')).status).toBe(409);
    expect((await api(`/api/upload/${encodeURIComponent(upload.key)}/verify`, 'POST')).status).toBe(
      404
    );
    expect(
      (await api(`/api/v1/files/upload/${upload.uploadId}/complete`, 'POST', otherHeaders)).status
    ).toBe(409);
  } finally {
    await observer.query('ROLLBACK');
    observer.release();
    pause.release();
  }
  expect((await pending).status, http.logs()).toBe(200);
  expect((await api(`/api/v1/files/upload/${upload.uploadId}/complete`, 'POST')).status).toBe(200);
});

it('commits abort intent before S3 and prevents completion from crossing that decision', async () => {
  const upload = await start();
  const pause = pauseStorage('DELETE', 'uploadId');
  const pending = api(`/api/v1/files/upload/${upload.uploadId}/abort`, 'POST');
  await pause.entered;
  const observer = await http.pool.connect();
  try {
    await observer.query('BEGIN');
    const state = await observer.query(
      'SELECT metadata FROM storage_records WHERE storage_key=$1 FOR UPDATE NOWAIT',
      [upload.key]
    );
    expect(state.rows[0].metadata.multipart.status).toBe('aborting');
    await observer.query('COMMIT');
    expect((await api(`/api/v1/files/upload/${upload.uploadId}/complete`, 'POST')).status).toBe(
      409
    );
  } finally {
    await observer.query('ROLLBACK');
    observer.release();
    pause.release();
  }
  expect((await pending).status, http.logs()).toBe(200);
  expect(
    (await api(`/api/v1/files/upload/${upload.uploadId}/part?partNumber=1`, 'PUT')).status
  ).toBe(409);
});

it('lets only the owner discard an interrupted completion after its reservation expires', async () => {
  const upload = await start();
  await http.pool.query(
    `UPDATE storage_records SET metadata=jsonb_set(metadata,'{multipart,status}','"completing"'::jsonb)||jsonb_build_object('uploadExpiresAt',NOW()-INTERVAL '1 hour') WHERE storage_key=$1`,
    [upload.key]
  );
  expect(
    (await api(`/api/v1/files/upload/${upload.uploadId}/abort`, 'POST', otherHeaders)).status
  ).toBe(409);
  expect(
    (await api(`/api/v1/files/upload/${upload.uploadId}/abort`, 'POST')).status,
    http.logs()
  ).toBe(200);
  expect(
    (
      await http.pool.query('SELECT metadata FROM storage_records WHERE storage_key=$1', [
        upload.key,
      ])
    ).rows[0].metadata.multipart.status
  ).toBe('aborted');
  expect((await api(`/api/v1/files/upload/${upload.uploadId}/complete`, 'POST')).status).toBe(409);
  expect((await api(`/api/upload/${encodeURIComponent(upload.key)}/verify`, 'POST')).status).toBe(
    404
  );
});
