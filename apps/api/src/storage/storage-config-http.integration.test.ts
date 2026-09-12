import { createServer, type Server } from 'node:http';
import { randomUUID } from 'node:crypto';
import { fork } from 'node:child_process';
import { resolve } from 'node:path';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { startHttpFixture } from '../test/http-fixture.js';

let http: Awaited<ReturnType<typeof startHttpFixture>>;
let server: Server;
let headers: Record<string, string>;
let endpoint: string;
let rejectProbe = false;
let onProbe: (() => Promise<void>) | undefined;
const authorizations: string[] = [];
beforeAll(async () => {
  server = createServer(async (req, res) => {
    authorizations.push(req.headers.authorization ?? '');
    await onProbe?.();
    if (rejectProbe) {
      res.writeHead(403);
      res.end('<Error><Code>AccessDenied</Code></Error>');
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

it('loads the durable configuration in another API process without S3 environment settings', async () => {
  const child = fork(resolve(__dirname, '../../scripts/http-test-server.cjs'), [], {
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
      S3_ACCESS_KEY_ID: '',
      S3_SECRET_ACCESS_KEY: '',
      REDIS_URL: '',
      REDIS_HOST: '',
    },
  });
  child.stdout?.resume();
  child.stderr?.resume();
  try {
    const port = await new Promise<number>((done, reject) => {
      const timeout = setTimeout(() => reject(new Error('Second API startup timed out')), 20000);
      child.once('message', (message: { port: number }) => {
        clearTimeout(timeout);
        done(message.port);
      });
      child.once('error', (error) => {
        clearTimeout(timeout);
        reject(error);
      });
      child.once('exit', () => {
        clearTimeout(timeout);
        reject(new Error('Second API exited'));
      });
    });
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
  } finally {
    if (child.exitCode === null && child.signalCode === null)
      await new Promise<void>((done) => {
        const timeout = setTimeout(() => child.kill('SIGKILL'), 5000);
        child.once('exit', () => {
          clearTimeout(timeout);
          done();
        });
        if (child.connected) child.send('stop');
        else child.kill('SIGTERM');
      });
  }
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
