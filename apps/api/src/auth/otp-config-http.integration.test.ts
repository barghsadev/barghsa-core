import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import * as argon2 from 'argon2';
import { startHttpFixture } from '../test/http-fixture.js';

let http: Awaited<ReturnType<typeof startHttpFixture>>;
let adminHeaders: Record<string, string>;
let customerHeaders: Record<string, string>;
const sessionId = randomUUID();
const termsId = randomUUID();
const password = 'OTP-config-test-password-123!';

beforeEach(async () => {
  vi.stubEnv('DB_POOL_MIN', '1');
  vi.stubEnv('DB_POOL_MAX', '1');
  if (!process.env.TEST_DATABASE_URL) throw new Error('PostgreSQL setup did not run');
  http = await startHttpFixture(process.env.TEST_DATABASE_URL);
  await http.pool.query(
    `INSERT INTO users(user_id,username,password_hash,is_admin)
     VALUES ('otp-admin','otp-admin@example.test',$1,true),('otp-customer','otp-customer@example.test',$1,false);
    `,
    [await argon2.hash(password)]
  );
  const csrf = randomUUID();
  await http.pool.query(
    `INSERT INTO sessions(session_id,user_id,csrf_token,family_id,expires_at,idle_deadline,step_up_verified_at)
     VALUES ($1,'otp-admin',$2,$3,NOW()+INTERVAL '1 day',NOW()+INTERVAL '30 minutes',NOW()),
            ($4,'otp-customer',$2,$5,NOW()+INTERVAL '1 day',NOW()+INTERVAL '30 minutes',NOW())`,
    [sessionId, csrf, randomUUID(), randomUUID(), randomUUID()]
  );
  adminHeaders = { Cookie: `barghsa_session=${sessionId}`, 'X-CSRF-Token': csrf };
  const customer = (
    await http.pool.query("SELECT session_id FROM sessions WHERE user_id='otp-customer'")
  ).rows[0];
  customerHeaders = { Cookie: `barghsa_session=${customer.session_id}`, 'X-CSRF-Token': csrf };
  await http.pool.query(
    `INSERT INTO tos_versions(id,version_id,content_fa,content_en,status,is_active,published_at)
     VALUES ($1,'otp-config-v1','قوانین','Terms','published',true,NOW())`,
    [termsId]
  );
}, 40000);
afterEach(async () => {
  await http?.close();
  vi.unstubAllEnvs();
}, 15000);

function request(
  path: string,
  method = 'GET',
  body?: unknown,
  headers: Record<string, string> = {}
) {
  return fetch(`${http.base}/api/${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...headers },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    signal: AbortSignal.timeout(7000),
  });
}
function update(body: unknown, headers = adminHeaders) {
  return request('admin/config/otp', 'PUT', body, headers);
}

async function expectNoChange() {
  expect((await http.pool.query("SELECT value FROM app_config WHERE key='auth_otp'")).rows).toEqual(
    []
  );
  expect(
    (await http.pool.query("SELECT id FROM audit_log WHERE metadata::jsonb->>'entity'='auth_otp'"))
      .rows
  ).toEqual([]);
}

it('requires current admin permissions, CSRF and recent password confirmation', async () => {
  expect((await request('admin/config/otp')).status).toBe(401);
  expect((await request('admin/config/otp', 'GET', undefined, customerHeaders)).status).toBe(403);
  expect((await update({ ttlSeconds: 120, expectedVersion: 0 }, customerHeaders)).status).toBe(403);
  expect(
    (await update({ ttlSeconds: 120, expectedVersion: 0 }, { Cookie: adminHeaders.Cookie! })).status
  ).toBe(403);
  await http.pool.query('UPDATE sessions SET step_up_verified_at=NULL WHERE session_id=$1', [
    sessionId,
  ]);
  const stale = await update({ ttlSeconds: 120, expectedVersion: 0 });
  expect(stale.status).toBe(403);
  await expectNoChange();
});

it('rejects invalid bounds, fractional values and missing versions without changing settings', async () => {
  for (const ttlSeconds of [59, 901, 1.5, '300', null]) {
    expect((await update({ ttlSeconds, expectedVersion: 0 })).status).toBe(400);
  }
  expect((await update({ ttlSeconds: 300 })).status).toBe(400);
  await expectNoChange();
});

it('persists a versioned audit and applies the lifetime to issuance and resend without changing existing deadlines', async () => {
  const before = await request('admin/config/otp', 'GET', undefined, adminHeaders);
  expect(await before.json()).toEqual({ ttlSeconds: 300, version: 0 });
  async function registration(username: string) {
    const response = await request('auth/register', 'POST', {
      username,
      password,
      tosVersionId: termsId,
    });
    const body = (await response.json()) as { challengeId: string };
    expect(response.status, JSON.stringify(body) + http.logs()).toBe(200);
    return body.challengeId;
  }
  const first = await registration('otp-first@example.test');
  const oldDeadline = (
    await http.pool.query('SELECT expires_at FROM otp_challenges WHERE challenge_id=$1', [first])
  ).rows[0].expires_at;
  const saved = await update({ ttlSeconds: 120, expectedVersion: 0 });
  expect(saved.status, await saved.clone().text()).toBe(200);
  expect(await saved.json()).toEqual({ ttlSeconds: 120, version: 1 });
  expect(await (await request('admin/config/otp', 'GET', undefined, adminHeaders)).json()).toEqual({
    ttlSeconds: 120,
    version: 1,
  });
  expect(
    (await http.pool.query('SELECT expires_at FROM otp_challenges WHERE challenge_id=$1', [first]))
      .rows[0].expires_at
  ).toEqual(oldDeadline);
  const next = await registration('otp-next@example.test');
  const login = await request('auth/login', 'POST', {
    username: 'otp-admin@example.test',
    password,
  });
  const loginBody = (await login.json()) as { requiresOtp: boolean; challengeId: string };
  expect(login.status, JSON.stringify(loginBody) + http.logs()).toBe(200);
  expect(loginBody.requiresOtp).toBe(true);
  const reset = await request('auth/forgot-password', 'POST', {
    username: 'otp-customer@example.test',
  });
  const resetBody = (await reset.json()) as { challengeId: string };
  expect(reset.status, JSON.stringify(resetBody)).toBe(200);
  await http.pool.query(
    "SELECT rate_limit_rolling_reset(true,'otp:dest:otp-first@example.test:60s')"
  );
  const resent = await request('auth/register/resend', 'POST', { challengeId: first });
  expect(resent.status, await resent.clone().text()).toBe(200);
  expect(await resent.json()).toEqual({ challengeId: first });
  const deadlines = (
    await http.pool.query(
      `SELECT c.challenge_id,extract(epoch FROM c.expires_at-clock_timestamp()) AS seconds,
      EXISTS(SELECT 1 FROM auth_delivery_outbox o WHERE o.challenge_id=c.challenge_id AND o.expires_at=c.expires_at) AS matching_delivery
     FROM otp_challenges c WHERE c.challenge_id=ANY($1::text[])`,
      [[first, next, loginBody.challengeId, resetBody.challengeId]]
    )
  ).rows;
  expect(deadlines).toHaveLength(4);
  for (const row of deadlines) {
    expect(Number(row.seconds)).toBeGreaterThan(110);
    expect(Number(row.seconds)).toBeLessThanOrEqual(120);
    expect(row.matching_delivery).toBe(true);
  }
  const audit = (
    await http.pool.query(
      "SELECT user_id,metadata::jsonb AS metadata,correlation_id FROM audit_log WHERE metadata::jsonb->>'entity'='auth_otp'"
    )
  ).rows;
  expect(audit).toEqual([
    {
      user_id: 'otp-admin',
      correlation_id: saved.headers.get('x-correlation-id'),
      metadata: {
        entity: 'auth_otp',
        previous: { ttlSeconds: 300, version: 0 },
        current: { ttlSeconds: 120, version: 1 },
      },
    },
  ]);
}, 15000);

it('accepts one concurrent versioned update and rejects the stale writer', async () => {
  const results = await Promise.all([
    update({ ttlSeconds: 120, expectedVersion: 0 }),
    update({ ttlSeconds: 600, expectedVersion: 0 }),
  ]);
  expect(results.map((response) => response.status).sort()).toEqual([200, 409]);
  expect(
    (await http.pool.query("SELECT version FROM app_config WHERE key='auth_otp'")).rows
  ).toEqual([{ version: 1 }]);
  expect(
    (await http.pool.query("SELECT id FROM audit_log WHERE metadata::jsonb->>'entity'='auth_otp'"))
      .rows
  ).toHaveLength(1);
});

it('rolls back configuration and global version if the audit write fails', async () => {
  const version = (await http.pool.query("SELECT version FROM config_version WHERE id='global'"))
    .rows[0].version;
  await http.pool
    .query(`CREATE FUNCTION reject_otp_config_audit() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN IF NEW.metadata::jsonb->>'entity'='auth_otp' THEN RAISE EXCEPTION 'Injected audit failure'; END IF; RETURN NEW; END $$;
    CREATE TRIGGER reject_otp_config_audit BEFORE INSERT ON audit_log FOR EACH ROW EXECUTE FUNCTION reject_otp_config_audit();`);
  expect((await update({ ttlSeconds: 120, expectedVersion: 0 })).status).toBe(500);
  await expectNoChange();
  expect(
    (await http.pool.query("SELECT version FROM config_version WHERE id='global'")).rows[0].version
  ).toBe(version);
});

for (const check of ['session', 'step-up']) {
  it(`rejects ${check} expiry while the configuration lock waits`, async () => {
    const deadline = (
      await http.pool.query(
        check === 'session'
          ? "UPDATE sessions SET expires_at=clock_timestamp()+INTERVAL '2 seconds' WHERE session_id=$1 RETURNING expires_at AS deadline"
          : "UPDATE sessions SET step_up_verified_at=clock_timestamp()-INTERVAL '15 minutes'+INTERVAL '2 seconds' WHERE session_id=$1 RETURNING step_up_verified_at+INTERVAL '15 minutes' AS deadline",
        [sessionId]
      )
    ).rows[0].deadline;
    const blocker = await http.pool.connect();
    let pending: Promise<Response> | undefined;
    try {
      await blocker.query('BEGIN');
      await blocker.query("SELECT pg_advisory_xact_lock(hashtextextended('auth_otp',0))");
      const pid = (await blocker.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;
      pending = update({ ttlSeconds: 120, expectedVersion: 0 });
      await expect
        .poll(
          async () =>
            (
              await http.pool.query(
                'SELECT count(*)::int AS count FROM pg_stat_activity WHERE $1=ANY(pg_blocking_pids(pid))',
                [pid]
              )
            ).rows[0].count
        )
        .toBe(1);
      await expect
        .poll(
          async () =>
            (
              await http.pool.query('SELECT clock_timestamp()>$1::timestamptz AS expired', [
                deadline,
              ])
            ).rows[0].expired,
          { timeout: 5000 }
        )
        .toBe(true);
      await blocker.query('COMMIT');
      const response = await pending;
      expect(response.status, await response.clone().text()).toBe(check === 'session' ? 401 : 403);
      await expectNoChange();
    } finally {
      await blocker.query('ROLLBACK');
      blocker.release();
      await pending;
    }
  }, 15000);
}

it('rechecks administrator authority after waiting for the actor lock', async () => {
  const blocker = await http.pool.connect();
  let pending: Promise<Response> | undefined;
  try {
    await blocker.query('BEGIN');
    await blocker.query("SELECT user_id FROM users WHERE user_id='otp-admin' FOR UPDATE");
    const pid = (await blocker.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;
    pending = update({ ttlSeconds: 120, expectedVersion: 0 });
    await expect
      .poll(
        async () =>
          (
            await http.pool.query(
              'SELECT count(*)::int AS count FROM pg_stat_activity WHERE $1=ANY(pg_blocking_pids(pid))',
              [pid]
            )
          ).rows[0].count
      )
      .toBe(1);
    await blocker.query("UPDATE users SET is_admin=false WHERE user_id='otp-admin'");
    await blocker.query('COMMIT');
    expect((await pending).status).toBe(403);
    await expectNoChange();
  } finally {
    await blocker.query('ROLLBACK');
    blocker.release();
    await pending;
  }
});

it('fails closed on malformed persisted settings without issuing a challenge', async () => {
  await http.pool.query(
    "INSERT INTO app_config(key,value,version) VALUES ('auth_otp','{\"ttlSeconds\":999999}',1)"
  );
  expect((await request('admin/config/otp', 'GET', undefined, adminHeaders)).status).toBe(503);
  const response = await request('auth/register', 'POST', {
    username: 'malformed@example.test',
    password,
    tosVersionId: termsId,
  });
  expect(response.status).toBe(503);
  // A configuration outage must not distinguish real accounts from unknown ones.
  for (const username of ['otp-customer@example.test', 'unknown@example.test']) {
    const reset = await request('auth/forgot-password', 'POST', { username });
    expect(reset.status).toBe(503);
  }
  expect(
    (await http.pool.query('SELECT count(*)::int AS count FROM otp_challenges')).rows[0].count
  ).toBe(0);
});
