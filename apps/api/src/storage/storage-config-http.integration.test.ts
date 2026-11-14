import { createServer, type Server } from 'node:http';
import { randomUUID } from 'node:crypto';
import { fork, type ChildProcess } from 'node:child_process';
import { resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startHttpFixture } from '../test/http-fixture.js';

let http: Awaited<ReturnType<typeof startHttpFixture>>;
let server: Server;
let headers: Record<string, string>;
let endpoint: string;
let rejectProbe = false;
let onProbe: (() => Promise<void>) | undefined;
const authorizations: string[] = [];
const probeObjects = new Map<string, { bytes: Buffer; nonce: string }>();
const probeRequests: {
  method: string;
  key: string;
  signed: boolean;
  expiry: string | null;
  version: string | null;
}[] = [];
const probeVersion = 'fixture-version';
let versioning: 'Enabled' | 'Suspended' | undefined;
let omitPutVersion = false;
let probeFault:
  'none' | 'upload' | 'download' | 'corrupt' | 'oversize' | 'cleanup' | 'lost-put' | 'ownership' =
  'none';
beforeAll(async () => {
  server = createServer(async (req, res) => {
    authorizations.push(req.headers.authorization ?? '');
    await onProbe?.();
    if (rejectProbe) {
      res.writeHead(403);
      res.end('<Error><Code>AccessDenied</Code></Error>');
      return;
    }
    const url = new URL(req.url!, 'http://localhost');
    if (url.searchParams.has('versioning')) {
      res.setHeader('Content-Type', 'application/xml');
      res.end(
        `<VersioningConfiguration xmlns="http://s3.amazonaws.com/doc/2006-03-01/">${versioning ? `<Status>${versioning}</Status>` : ''}</VersioningConfiguration>`
      );
      return;
    }
    if (url.pathname.includes('/_storage_probes/')) {
      probeRequests.push({
        method: req.method!,
        key: url.pathname,
        signed: url.searchParams.has('X-Amz-Signature'),
        expiry: url.searchParams.get('X-Amz-Expires'),
        version: url.searchParams.get('versionId'),
      });
      if (
        (req.method === 'PUT' && probeFault === 'upload') ||
        (req.method === 'GET' && probeFault === 'download') ||
        (req.method === 'DELETE' && probeFault === 'cleanup')
      ) {
        res.writeHead(403);
        res.end('<Error><Code>AccessDenied</Code></Error>');
        return;
      }
      if (req.method === 'PUT') {
        expect(req.headers['content-type']).toBe('application/octet-stream');
        expect(req.headers['if-none-match']).toBe('*');
        const nonce = String(req.headers['x-amz-meta-barghsa-probe']);
        expect(url.pathname.endsWith(`/${nonce}`)).toBe(true);
        const chunks: Buffer[] = [];
        for await (const chunk of req) chunks.push(Buffer.from(chunk));
        probeObjects.set(url.pathname, { bytes: Buffer.concat(chunks), nonce });
        if (probeFault === 'lost-put') {
          req.socket.destroy();
          return;
        }
        if (versioning && !omitPutVersion) res.setHeader('x-amz-version-id', probeVersion);
        res.setHeader('ETag', '"probe-etag"');
        res.end();
        return;
      }
      if (req.method === 'DELETE') {
        if (versioning) {
          if (url.searchParams.get('versionId') !== probeVersion) {
            res.setHeader('x-amz-delete-marker', 'true');
            res.writeHead(204).end();
            return;
          }
          res.setHeader('x-amz-version-id', probeVersion);
        }
        probeObjects.delete(url.pathname);
        res.writeHead(204);
        res.end();
        return;
      }
      const object = probeObjects.get(url.pathname);
      if (!object) {
        res.writeHead(404);
        res.end();
        return;
      }
      if (req.method === 'HEAD') {
        if (versioning) res.setHeader('x-amz-version-id', probeVersion);
        res.setHeader(
          'x-amz-meta-barghsa-probe',
          probeFault === 'ownership' ? 'unrelated' : object.nonce
        );
        res.setHeader('ETag', '"probe-etag"');
        res.end();
        return;
      }
      const { bytes } = object;
      res.setHeader('Content-Type', 'application/octet-stream');
      res.end(
        probeFault === 'corrupt'
          ? Buffer.from('wrong bytes')
          : probeFault === 'oversize'
            ? Buffer.concat([bytes, Buffer.from('extra')])
            : bytes
      );
      return;
    }
    if (new URL(req.url!, 'http://localhost').searchParams.has('list-type')) {
      res.setHeader('Content-Type', 'application/xml');
      res.end(
        '<ListBucketResult><Name>test-evidence</Name><KeyCount>0</KeyCount><IsTruncated>false</IsTruncated></ListBucketResult>'
      );
    } else {
      res.setHeader('Content-Type', 'application/pdf');
      res.end('%PDF-1.7 test');
    }
  });
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
  endpoint = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  http = await startHttpFixture(process.env.TEST_DATABASE_URL!, endpoint);
  await http.pool.query(
    "INSERT INTO users(user_id,username,password_hash,is_staff) VALUES ('storage-editor','storage@example.test','test-only',true)"
  );
  await http.pool.query(
    "INSERT INTO staff_roles(role_id,name,description,permissions) VALUES ('storage-editor-role','Storage editor','Test storage editor','[\"admin:storage:edit\"]')"
  );
  await http.pool.query(
    "INSERT INTO user_roles(user_id,role_id) VALUES ('storage-editor','storage-editor-role')"
  );
  const session = randomUUID(),
    csrf = randomUUID();
  await http.pool.query(
    `INSERT INTO sessions(session_id,user_id,csrf_token,family_id,expires_at,idle_deadline,step_up_verified_at)
    VALUES ($1,'storage-editor',$2,$3,NOW()+INTERVAL '1 day',NOW()+INTERVAL '30 minutes',NOW())`,
    [session, csrf, randomUUID()]
  );
  headers = {
    Cookie: `barghsa_session=${session}`,
    'X-CSRF-Token': csrf,
    'Content-Type': 'application/json',
  };
}, 40000);
afterAll(async () => {
  await http?.close();
  await new Promise<void>((done) => server?.close(() => done()));
});
function request(path = '/config', method = 'GET', body?: unknown, auth = headers) {
  return fetch(`${http.base}/api/admin/storage${path}`, {
    method,
    headers: auth,
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}
async function current() {
  return (await (await request()).json()) as Record<string, unknown>;
}
async function update(secret?: string): Promise<Record<string, unknown>> {
  const { hasSecretKey: _masked, ...config } = await current();
  return { ...config, ...(secret === undefined ? {} : { secretAccessKey: secret }) };
}

it('returns owned storage fields without echoing credentials or writing invalid configuration', async () => {
  const before = await current();
  const response = await request('/config', 'PUT', {
    ...(await update('private-field-test-secret')),
    endpoint: 'https://private-field-test-secret:password@example.test/path',
    bucket: ' ',
  });
  expect(response.status, http.logs()).toBe(400);
  const body: unknown = await response.json();
  expect(body).toMatchObject({
    error: { code: 'VALIDATION:INPUT:INVALID', fields: ['endpoint', 'bucket'] },
  });
  expect(JSON.stringify(body)).not.toContain('private-field-test-secret');
  expect(await current()).toEqual(before);
});

it('rejects unapproved origins before any probe, credential write or audit', async () => {
  const sink = createServer((_request, response) => response.writeHead(403).end());
  const observed = { connections: 0 };
  sink.on('connection', () => observed.connections++);
  await new Promise<void>((done) => sink.listen(0, '127.0.0.1', done));
  try {
    const origin = `http://127.0.0.1:${(sink.address() as { port: number }).port}`;
    const before = await update('private-probe-key');
    const candidate = { ...before, privateEndpointUrl: origin };
    const priorCalls = authorizations.length;
    for (const [path, method] of [
      ['/test-connection', 'POST'],
      ['/config', 'PUT'],
    ] as const) {
      const response = await request(path, method, candidate);
      expect(response.status).toBe(400);
      const body: unknown = await response.json();
      expect(body).toMatchObject({
        error: { code: 'VALIDATION:INPUT:INVALID', fields: ['privateEndpointUrl'] },
      });
      expect(JSON.stringify(body)).not.toContain('private-probe-key');
    }
    expect(observed.connections).toBe(0);
    expect(authorizations).toHaveLength(priorCalls);
    expect((await current()).version).toBe(before.version);
    expect(
      (await http.pool.query("SELECT id FROM audit_log WHERE event='storage.config.updated'")).rows
    ).toHaveLength(0);
  } finally {
    await new Promise<void>((done) => sink.close(() => done()));
  }
});
it('keeps cleanup policy unchanged after an owned hours error', async () => {
  const before = await (await request('/multipart-cleanup-policy')).json();
  const response = await request('/multipart-cleanup-policy', 'PUT', { hours: 169, version: 0 });
  expect(response.status, http.logs()).toBe(400);
  expect(await response.json()).toMatchObject({
    error: { code: 'VALIDATION:INPUT:INVALID', fields: ['hours'] },
  });
  expect(await (await request('/multipart-cleanup-policy')).json()).toEqual(before);
});
it('checks current storage permission before returning invalid cleanup fields', async () => {
  await http.pool.query(
    "UPDATE staff_roles SET permissions='[]' WHERE role_id='storage-editor-role'"
  );
  try {
    const response = await request('/multipart-cleanup-policy', 'PUT', { hours: 169, version: 0 });
    expect(response.status).toBe(403);
    const body: unknown = await response.json();
    expect(body).not.toHaveProperty('error.fields');
  } finally {
    await http.pool.query(
      "UPDATE staff_roles SET permissions='[\"admin:storage:edit\"]' WHERE role_id='storage-editor-role'"
    );
  }
});

it('lets a verified storage admin set the orphan cleanup age with optimistic versioning', async () => {
  const initial = await request('/multipart-cleanup-policy');
  expect(initial.status).toBe(200);
  expect(await initial.json()).toEqual({ hours: 24, version: 0 });
  expect((await request('/multipart-cleanup-policy', 'PUT', { hours: 0, version: 0 })).status).toBe(
    400
  );
  expect(
    (await request('/multipart-cleanup-policy', 'PUT', { hours: 48, version: 0 }, {})).status
  ).toBe(401);
  const saved = await request('/multipart-cleanup-policy', 'PUT', { hours: 48, version: 0 });
  expect(saved.status, http.logs()).toBe(200);
  expect(await saved.json()).toEqual({ hours: 48, version: 1 });
  expect((await request('/multipart-cleanup-policy')).status).toBe(200);
  expect(
    (await request('/multipart-cleanup-policy', 'PUT', { hours: 12, version: 0 })).status
  ).toBe(409);
  expect(
    (
      await http.pool.query(
        "SELECT event FROM audit_log WHERE event='storage.multipart_cleanup_policy_updated'"
      )
    ).rows
  ).toHaveLength(1);
});

it('allows only one writer to create the initial cleanup policy version', async () => {
  await http.pool.query("DELETE FROM app_config WHERE key='storage.multipart_orphan_hours'");
  const attempts = await Promise.all([
    request('/multipart-cleanup-policy', 'PUT', { hours: 36, version: 0 }),
    request('/multipart-cleanup-policy', 'PUT', { hours: 48, version: 0 }),
  ]);
  expect(attempts.map((response) => response.status).sort()).toEqual([200, 409]);
  expect(await (await request('/multipart-cleanup-policy')).json()).toMatchObject({ version: 1 });
});

it('reports a paused cleanup policy and lets authorized staff repair its current version', async () => {
  await http.pool.query(`
    INSERT INTO app_config(key,value,version)
    VALUES('storage.multipart_orphan_hours','{}'::jsonb,7)
    ON CONFLICT(key) DO UPDATE SET value=EXCLUDED.value,version=EXCLUDED.version
  `);
  const paused = await request('/multipart-cleanup-policy');
  expect(paused.status).toBe(200);
  expect(await paused.json()).toEqual({ hours: null, version: 7 });
  expect(
    (await request('/multipart-cleanup-policy', 'PUT', { hours: 48, version: 6 })).status
  ).toBe(409);
  const repaired = await request('/multipart-cleanup-policy', 'PUT', { hours: 48, version: 7 });
  expect(repaired.status, http.logs()).toBe(200);
  expect(await repaired.json()).toEqual({ hours: 48, version: 8 });
  expect(await (await request('/multipart-cleanup-policy')).json()).toEqual({
    hours: 48,
    version: 8,
  });
});

it('restores a historical cleanup age through a separate version-bound activation', async () => {
  type Revision = { id: string; version: number; config: { hours: number } };
  type Draft = {
    id: string;
    baseVersion: number;
    sourceId: string;
    sourceVersion: number;
    config: { hours: number };
  };
  const policy = '/multipart-cleanup-policy';
  const read = async () =>
    (await (await request(policy)).json()) as { hours: number; version: number };
  const base = await read();
  const first = await request(policy, 'PUT', { hours: 36, version: base.version });
  expect(first.status, http.logs()).toBe(200);
  const second = await request(policy, 'PUT', { hours: 60, version: base.version + 1 });
  expect(second.status, http.logs()).toBe(200);
  const third = await request(policy, 'PUT', { hours: 84, version: base.version + 2 });
  expect(third.status, http.logs()).toBe(200);
  const active = { hours: 84, version: base.version + 3 };
  const history = `${policy}/rollback-history`;
  const stage = `${policy}/rollback-draft`;
  const activate = `${policy}/rollback-activate`;
  expect((await request(history, 'GET', undefined, {})).status).toBe(401);
  expect((await request(`${history}?beforeVersion=0`)).status).toBe(400);
  const result = await request(history);
  expect(result.status, http.logs()).toBe(200);
  expect(result.headers.get('cache-control')).toContain('no-store');
  const data = (await result.json()) as {
    baseVersion: number;
    draft: Draft | null;
    items: Revision[];
  };
  expect(data).toMatchObject({ baseVersion: active.version, draft: null });
  const source = data.items[0]!;
  const older = data.items[1]!;
  expect(source).toMatchObject({ version: base.version + 2, config: { hours: 60 } });
  expect(older).toMatchObject({ version: base.version + 1, config: { hours: 36 } });
  const command = { sourceId: source.id, expectedVersion: active.version };
  expect((await request(stage, 'POST', command, { Cookie: headers.Cookie! })).status).toBe(403);
  const firstDraft = await request(stage, 'POST', command);
  expect(firstDraft.status, http.logs()).toBe(201);
  const replaced = (await firstDraft.json()) as Draft;
  expect(await (await request(stage, 'POST', command)).json()).toEqual(replaced);
  expect((await request(stage, 'POST', { ...command, sourceId: older.id })).status).toBe(201);
  expect(
    (await request(activate, 'POST', { draftId: replaced.id, expectedVersion: active.version }))
      .status
  ).toBe(409);
  const prepared = await request(stage, 'POST', command);
  expect(prepared.status, http.logs()).toBe(201);
  const draft = (await prepared.json()) as Draft;
  expect(draft).toMatchObject({ ...replaced, id: expect.any(String) });
  expect(draft.id).not.toBe(replaced.id);
  expect(await read()).toEqual(active);
  const activation = { draftId: draft.id, expectedVersion: active.version };
  await http.pool.query(
    "UPDATE sessions SET step_up_verified_at=NULL WHERE user_id='storage-editor'"
  );
  try {
    expect((await request(activate, 'POST', activation)).status).toBe(403);
  } finally {
    await http.pool.query(
      "UPDATE sessions SET step_up_verified_at=NOW() WHERE user_id='storage-editor'"
    );
  }
  expect(await read()).toEqual(active);
  const outcomes = await Promise.all([
    request(activate, 'POST', activation),
    request(activate, 'POST', activation),
  ]);
  expect(outcomes.map((response) => response.status).sort()).toEqual([200, 409]);
  expect(await outcomes.find((response) => response.ok)!.json()).toEqual({
    config: { hours: 60 },
    version: active.version + 1,
    draftId: draft.id,
  });
  expect(await read()).toEqual({ hours: 60, version: active.version + 1 });
  const { rows } = await http.pool.query(
    "SELECT metadata FROM audit_log WHERE event='storage.multipart_cleanup_policy_updated' AND metadata::jsonb->>'draftId'=$1",
    [draft.id]
  );
  expect(rows).toHaveLength(1);
  expect(JSON.parse(rows[0].metadata)).toMatchObject({
    hours: 60,
    previousVersion: active.version,
    sourceId: source.id,
    sourceVersion: source.version,
  });
  expect(await (await request(history)).json()).toMatchObject({ draft: null });
});

it('persists encrypted configuration, activates new signing credentials, and rejects stale saves', async () => {
  const initial = await update('new-secret-never-return');
  const candidate = { ...initial, accessKeyId: 'new-access-key' };
  expect((await request('/config', 'PUT', candidate, {})).status).toBe(401);
  expect((await request('/config', 'PUT', candidate, { Cookie: headers.Cookie! })).status).toBe(
    403
  );
  expect((await request('/test-connection', 'POST', candidate)).status).toBe(200);
  expect(
    (await http.pool.query("SELECT key FROM app_config WHERE key='storage.active'")).rows
  ).toHaveLength(0);
  const saved = await request('/config', 'PUT', candidate);
  expect(saved.status, http.logs()).toBe(200);
  const body = await saved.text();
  expect(body).not.toContain('new-secret-never-return');
  expect(JSON.parse(body)).toMatchObject({
    version: 1,
    hasSecretKey: true,
    accessKeyId: 'new-access-key',
  });
  const stored = (await http.pool.query("SELECT value FROM app_config WHERE key='storage.active'"))
    .rows[0].value;
  expect(JSON.stringify(stored)).not.toContain('new-secret-never-return');
  expect(stored.encryptedSecret).toMatch(/^v1:/);
  expect((await request('/config', 'PUT', candidate)).status).toBe(409);
  const presign = await fetch(`${http.base}/api/upload/presigned-url`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      fileName: 'proof.pdf',
      contentType: 'application/pdf',
      fileSize: 13,
      category: 'document',
    }),
  });
  expect(presign.status, await presign.clone().text()).toBe(200);
  expect(JSON.stringify(await presign.json())).toContain('new-access-key');
  expect(authorizations.some((value) => value.includes('new-access-key'))).toBe(true);
  expect(http.logs()).not.toContain('new-secret-never-return');
});

it('keeps the previous revision when connection testing or audit persistence fails', async () => {
  const candidate = await update();
  rejectProbe = true;
  try {
    expect((await request('/config', 'PUT', candidate)).status).toBe(503);
  } finally {
    rejectProbe = false;
  }
  expect((await current()).version).toBe(candidate.version);
  await http.pool
    .query(`CREATE FUNCTION fail_storage_config_audit() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN IF NEW.event='storage.config.updated' THEN RAISE EXCEPTION 'injected storage audit failure'; END IF; RETURN NEW; END $$;
    CREATE TRIGGER fail_storage_config_audit BEFORE INSERT ON audit_log FOR EACH ROW EXECUTE FUNCTION fail_storage_config_audit()`);
  try {
    expect((await request('/config', 'PUT', candidate)).status).toBe(500);
  } finally {
    await http.pool.query('DROP TRIGGER fail_storage_config_audit ON audit_log');
  }
  expect((await current()).version).toBe(candidate.version);
});

it('protects existing object locations and requires explicit credentials for a changed endpoint', async () => {
  const candidate = await update();
  expect(
    (await request('/config', 'PUT', { ...candidate, endpoint: `${endpoint}/private/path` })).status
  ).toBe(400);
  expect(
    (await request('/config', 'PUT', { ...candidate, bucket: 'different-bucket' })).status
  ).toBe(400);
  expect(
    (
      await request('/config', 'PUT', {
        ...candidate,
        bucket: 'different-bucket',
        secretAccessKey: 'explicit-test-secret',
      })
    ).status
  ).toBe(409);
  expect((await current()).bucket).toBe('test-evidence');
});

it('rejects a revoked editor after the connection probe without persisting a revision', async () => {
  const candidate = await update();
  let reached!: () => void, release!: () => void;
  const arrived = new Promise<void>((done) => {
    reached = done;
  });
  const held = new Promise<void>((done) => {
    release = done;
  });
  onProbe = async () => {
    reached();
    await held;
  };
  const pending = request('/config', 'PUT', candidate);
  try {
    await arrived;
    await http.pool.query("DELETE FROM user_roles WHERE user_id='storage-editor'");
    release();
    expect((await pending).status).toBe(403);
  } finally {
    release();
    onProbe = undefined;
    await pending;
    await http.pool.query(
      "INSERT INTO user_roles(user_id,role_id) VALUES ('storage-editor','storage-editor-role') ON CONFLICT DO NOTHING"
    );
  }
  expect((await current()).version).toBe(candidate.version);
  expect(
    (await http.pool.query("SELECT id FROM audit_log WHERE event='storage.config.updated'")).rows
  ).toHaveLength(1);
});

describe('storage configuration shared across API processes', () => {
  let child: ChildProcess | undefined;
  let port: number;

  beforeAll(async () => {
    const started = fork(resolve(__dirname, '../../scripts/http-test-server.cjs'), [], {
      silent: true,
      env: {
        ...process.env,
        NODE_ENV: 'test',
        DATABASE_URL: http.pool.options.connectionString!,
        PGDIRECT_URL: http.pool.options.connectionString!,
        AUTH_DELIVERY_ENCRYPTION_KEY: 'http-fixture-delivery-key-only',
        STORAGE_CONFIG_ENCRYPTION_KEY: 'http-fixture-storage-key-only',
        S3_BUCKET: '',
        S3_REGION: '',
        S3_ENDPOINT: '',
        S3_PRIVATE_ENDPOINT: '',
        S3_PUBLIC_ENDPOINT: '',
        S3_ALLOWED_ENDPOINT_ORIGINS: endpoint,
        S3_ACCESS_KEY_ID: '',
        S3_SECRET_ACCESS_KEY: '',
        REDIS_URL: '',
        REDIS_HOST: '',
      },
    });
    child = started;
    started.stdout?.resume();
    started.stderr?.resume();
    port = await new Promise<number>((done, reject) => {
      const timeout = setTimeout(() => reject(new Error('Second API startup timed out')), 20000);
      started.once('message', (message: { port: number }) => {
        clearTimeout(timeout);
        done(message.port);
      });
      started.once('error', (error) => {
        clearTimeout(timeout);
        reject(error);
      });
      started.once('exit', () => {
        clearTimeout(timeout);
        reject(new Error('Second API exited'));
      });
    });
  }, 25_000);

  afterAll(async () => {
    const started = child;
    if (started && started.exitCode === null && started.signalCode === null)
      await new Promise<void>((done) => {
        const timeout = setTimeout(() => started.kill('SIGKILL'), 5000);
        started.once('exit', () => {
          clearTimeout(timeout);
          done();
        });
        if (started.connected) started.send('stop');
        else started.kill('SIGTERM');
      });
  }, 10_000);

  it('loads the durable configuration in another API process without S3 environment settings', async () => {
    const config = await fetch(`http://127.0.0.1:${port}/api/admin/storage/config`, { headers });
    expect(config.status).toBe(200);
    expect(await config.json()).toMatchObject({
      version: 1,
      accessKeyId: 'new-access-key',
      hasSecretKey: true,
    });
    const signed = await fetch(`http://127.0.0.1:${port}/api/upload/presigned-url`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        fileName: 'second.pdf',
        contentType: 'application/pdf',
        fileSize: 13,
        category: 'document',
      }),
    });
    expect(signed.status).toBe(200);
    expect(JSON.stringify(await signed.json())).toContain('new-access-key');
  });
});

for (const operation of ['save', 'test'] as const) {
  for (const failure of ['expiry', 'csrf', 'step-up'] as const) {
    it(`rejects ${operation} when ${failure} changes during the storage probe`, async () => {
      const candidate = await update();
      const session = headers.Cookie!.split('=')[1]!;
      let changed = false;
      onProbe = async () => {
        if (changed) return;
        changed = true;
        await http.pool.query(
          failure === 'expiry'
            ? "UPDATE sessions SET expires_at=NOW()-INTERVAL '1 minute' WHERE session_id=$1"
            : failure === 'csrf'
              ? "UPDATE sessions SET csrf_token='rotated-token' WHERE session_id=$1"
              : 'UPDATE sessions SET step_up_verified_at=NULL WHERE session_id=$1',
          [session]
        );
      };
      const before = authorizations.length;
      try {
        expect(
          (
            await request(
              operation === 'save' ? '/config' : '/test-connection',
              operation === 'save' ? 'PUT' : 'POST',
              candidate
            )
          ).status
        ).toBe(failure === 'expiry' ? 401 : 403);
        expect(authorizations.length - before).toBe(1);
      } finally {
        onProbe = undefined;
        await http.pool.query(
          "UPDATE sessions SET expires_at=NOW()+INTERVAL '1 day',csrf_token=$2,step_up_verified_at=NOW()-INTERVAL '1 minute' WHERE session_id=$1",
          [session, headers['X-CSRF-Token']]
        );
      }
      expect((await current()).version).toBe(candidate.version);
    });
  }
}

it('rolls back storage credentials and audit if the session expires during the write', async () => {
  const candidate = await update();
  await http.pool
    .query(`CREATE FUNCTION expire_storage_session() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN IF NEW.event='storage.config.updated' THEN UPDATE sessions SET expires_at=NOW()-INTERVAL '1 minute' WHERE user_id=NEW.user_id; END IF; RETURN NEW; END $$;
    CREATE TRIGGER expire_storage_session AFTER INSERT ON audit_log FOR EACH ROW EXECUTE FUNCTION expire_storage_session()`);
  try {
    expect((await request('/config', 'PUT', candidate)).status).toBe(401);
  } finally {
    await http.pool.query('DROP TRIGGER expire_storage_session ON audit_log');
    await http.pool.query(
      "UPDATE sessions SET expires_at=NOW()+INTERVAL '1 day' WHERE user_id='storage-editor'"
    );
  }
  expect((await current()).version).toBe(candidate.version);
});

it('records the exact verified timestamp with the storage credential audit', async () => {
  const at = new Date(Date.now() - 60000).toISOString();
  await http.pool.query(
    "UPDATE sessions SET step_up_verified_at=$1 WHERE user_id='storage-editor'",
    [at]
  );
  const candidate = await update();
  expect((await request('/config', 'PUT', candidate)).status).toBe(200);
  const row = (
    await http.pool.query(
      "SELECT metadata FROM audit_log WHERE event='storage.config.updated' ORDER BY created_at DESC LIMIT 1"
    )
  ).rows[0];
  expect(typeof row.metadata === 'string' ? JSON.parse(row.metadata) : row.metadata).toMatchObject({
    stepUpVerified: true,
    stepUpVerifiedAt: at,
  });
});

it('proves a disposable upload and signed browser download, then removes only its own probe object', async () => {
  const candidate = await update();
  const before = await current();
  probeRequests.length = 0;
  expect((await request('/test-connection', 'POST', candidate)).status).toBe(200);
  expect(probeRequests.map((r) => r.method)).toEqual(['PUT', 'GET', 'HEAD', 'DELETE']);
  expect(new Set(probeRequests.map((r) => r.key)).size).toBe(1);
  expect(probeRequests[0]?.key).toMatch(/\/_storage_probes\/[0-9a-f-]{36}$/);
  expect(probeRequests[1]).toMatchObject({ signed: true, expiry: '60' });
  expect(probeObjects.size).toBe(0);
  expect(await current()).toEqual(before);
});

it.each(['Enabled', 'Suspended'] as const)(
  'cleans the exact version in a %s bucket even when PUT omits it',
  async (status) => {
    const before = await current();
    versioning = status;
    omitPutVersion = status === 'Suspended';
    probeRequests.length = 0;
    try {
      const result = await request('/test-connection', 'POST', await update());
      expect(result.status, http.logs()).toBe(200);
      expect(probeRequests.map(({ method }) => method)).toEqual(
        omitPutVersion ? ['PUT', 'GET', 'HEAD', 'DELETE'] : ['PUT', 'GET', 'DELETE']
      );
      expect(probeRequests.at(-1)?.version).toBe(probeVersion);
      expect(new Set(probeRequests.map(({ key }) => key)).size).toBe(1);
      expect(probeObjects.size).toBe(0);
      expect(await current()).toEqual(before);
    } finally {
      versioning = undefined;
      omitPutVersion = false;
      probeObjects.clear();
    }
  }
);

it.each(['lost-put', 'ownership'] as const)(
  'refuses activation and safely reconciles probe cleanup after %s',
  async (fault) => {
    const before = await current();
    versioning = 'Enabled';
    omitPutVersion = true;
    probeFault = fault;
    probeRequests.length = 0;
    try {
      const result = await request('/config', 'PUT', await update());
      expect(result.status, http.logs()).toBe(503);
      expect(probeRequests.map(({ method }) => method)).toEqual(
        fault === 'lost-put' ? ['PUT', 'HEAD', 'DELETE'] : ['PUT', 'GET', 'HEAD']
      );
      expect(probeObjects.size).toBe(fault === 'lost-put' ? 0 : 1);
      if (fault === 'lost-put') expect(probeRequests.at(-1)?.version).toBe(probeVersion);
      expect(await current()).toEqual(before);
    } finally {
      versioning = undefined;
      omitPutVersion = false;
      probeFault = 'none';
      probeObjects.clear();
    }
  }
);

for (const fault of ['upload', 'download', 'corrupt', 'oversize', 'cleanup'] as const) {
  it(`refuses an unproved ${fault} probe without changing configuration or echoing secrets`, async () => {
    const before = await current();
    probeFault = fault;
    probeRequests.length = 0;
    try {
      const response = await request('/config', 'PUT', await update());
      expect(response.status).toBe(503);
      const body = await response.json();
      expect(body).toMatchObject({
        error: { code: 'STORAGE:CONNECTION_FAILED', correlationId: expect.any(String) },
      });
      expect(JSON.stringify(body)).not.toContain('new-secret-never-return');
      expect(JSON.stringify(body)).not.toContain('new-access-key');
      expect(await current()).toEqual(before);
      expect(probeRequests.at(-1)?.method).toBe(fault === 'upload' ? 'HEAD' : 'DELETE');
      if (fault !== 'cleanup') expect(probeObjects.size).toBe(0);
    } finally {
      probeFault = 'none';
      probeObjects.clear();
    }
  });
}

it('restores reviewed settings without retaining or reusing historical credentials', async () => {
  const previous = await update('retired-credential-for-fixture');
  const old = await request('/config', 'PUT', {
    ...previous,
    accessKeyId: 'retired-key',
    forcePathStyle: true,
  });
  expect(old.status, http.logs()).toBe(200);
  const live = await request('/config', 'PUT', {
    ...(await update('active-credential-for-fixture')),
    accessKeyId: 'active-key',
    forcePathStyle: false,
  });
  expect(live.status, http.logs()).toBe(200);
  const baseVersion = (previous.version as number) + 2;
  const history = '/config/rollback-history';
  expect((await request(history, 'GET', undefined, {})).status).toBe(401);
  expect((await request(`${history}?beforeVersion=0`)).status).toBe(400);
  const response = await request(history);
  expect(response.status, http.logs()).toBe(200);
  expect(response.headers.get('cache-control')).toContain('no-store');
  const historyText = await response.text();
  expect(historyText).not.toMatch(/retired|active-key|encryptedSecret|accessKeyId/);
  const body = JSON.parse(historyText);
  expect(body.baseVersion).toBe(baseVersion);
  const source = body.items.find((row: { version: number }) => row.version === baseVersion - 1);
  expect(source.config).toEqual({
    endpoint: previous.endpoint,
    privateEndpointUrl: previous.privateEndpointUrl,
    publicEndpointUrl: previous.publicEndpointUrl,
    region: previous.region,
    bucket: previous.bucket,
    forcePathStyle: true,
  });
  const draftRoute = '/config/rollback-draft';
  const input = { sourceId: source.id, expectedVersion: baseVersion };
  expect((await request(draftRoute, 'POST', input, { Cookie: headers.Cookie! })).status).toBe(403);
  const unavailableSource = randomUUID();
  await http.pool.query(
    `INSERT INTO audit_log(id,user_id,event,metadata) VALUES($1,'storage-editor','storage.config.updated',$2)`,
    [
      unavailableSource,
      JSON.stringify({
        previousVersion: baseVersion - 1,
        previousSettings: {
          ...source.config,
          privateEndpointUrl: 'https://retired-origin.example.test',
        },
      }),
    ]
  );
  const unapproved = await request(draftRoute, 'POST', { ...input, sourceId: unavailableSource });
  expect(unapproved.status).toBe(400);
  expect(await unapproved.json()).toMatchObject({ error: { code: 'STORAGE:ENDPOINT_UNAPPROVED' } });
  expect((await request(draftRoute, 'POST', { ...input, sourceId: randomUUID() })).status).toBe(
    404
  );
  expect(
    (await request(draftRoute, 'POST', { ...input, expectedVersion: baseVersion - 1 })).status
  ).toBe(409);
  const staged = await request(draftRoute, 'POST', input);
  expect(staged.status, http.logs()).toBe(201);
  const draft = JSON.parse(await staged.text());
  expect(draft).toMatchObject({ baseVersion, sourceId: source.id, config: source.config });
  expect(await (await request(draftRoute, 'POST', input)).json()).toEqual(draft);
  expect((await current()).version).toBe(baseVersion);
  const activate = '/config/rollback-activate';
  const activation = { draftId: draft.id, expectedVersion: baseVersion };
  await http.pool.query(
    "UPDATE sessions SET step_up_verified_at=NULL WHERE user_id='storage-editor'"
  );
  try {
    expect((await request(activate, 'POST', activation)).status).toBe(403);
  } finally {
    await http.pool.query(
      "UPDATE sessions SET step_up_verified_at=NOW() WHERE user_id='storage-editor'"
    );
  }
  expect((await current()).forcePathStyle).toBe(false);
  const beforeProbe = authorizations.length;
  probeFault = 'corrupt';
  try {
    expect((await request(activate, 'POST', activation)).status).toBe(503);
  } finally {
    probeFault = 'none';
  }
  expect((await current()).version).toBe(baseVersion);
  expect(await (await request(history)).json()).toMatchObject({ draft });
  const outcomes = await Promise.all([
    request(activate, 'POST', activation),
    request(activate, 'POST', activation),
  ]);
  expect(outcomes.map((result) => result.status).sort()).toEqual([200, 409]);
  expect(await outcomes.find((result) => result.ok)!.json()).toEqual({
    config: source.config,
    version: baseVersion + 1,
    draftId: draft.id,
  });
  expect(await current()).toMatchObject({
    accessKeyId: 'active-key',
    hasSecretKey: true,
    forcePathStyle: true,
  });
  expect(authorizations.slice(beforeProbe).some((header) => header.includes('active-key'))).toBe(
    true
  );
  expect(authorizations.slice(beforeProbe).some((header) => header.includes('retired-key'))).toBe(
    false
  );
  const { rows } = await http.pool.query(
    "SELECT metadata FROM audit_log WHERE event = 'storage.config.updated' AND metadata::jsonb->>'draftId'=$1",
    [draft.id]
  );
  expect(rows).toHaveLength(1);
  expect(JSON.parse(rows[0].metadata)).toMatchObject({
    sourceId: source.id,
    version: baseVersion + 1,
  });
  expect(rows[0].metadata).not.toMatch(/retired|active-key|encryptedSecret|accessKeyId/);
  expect(http.logs()).not.toContain('retired-credential-for-fixture');
  expect(http.logs()).not.toContain('active-credential-for-fixture');
});
