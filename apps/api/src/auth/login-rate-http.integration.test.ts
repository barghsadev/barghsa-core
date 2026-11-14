import { fetchWithPreauth } from '../test/public-auth.js';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { createHash, randomUUID } from 'node:crypto';
import * as argon2 from 'argon2';
import { startHttpFixture } from '../test/http-fixture.js';

let http: Awaited<ReturnType<typeof startHttpFixture>>;
const password = 'Local-login-fixture-123!';
const username = 'login-limit@example.test';
const deviceToken = 'a'.repeat(64);
const failureKey = (name: string) =>
  'login:failures:' +
  createHash('sha256')
    .update(JSON.stringify([name, '127.0.0.1']))
    .digest('hex');

beforeEach(async () => {
  if (!process.env.TEST_DATABASE_URL) throw new Error('PostgreSQL setup did not run');
  http = await startHttpFixture(process.env.TEST_DATABASE_URL);
  await http.pool.query(
    `INSERT INTO users(user_id,username,password_hash)
    VALUES ('login-limit-user',$1,$2)`,
    [username, await argon2.hash(password)]
  );
  await http.pool.query(
    `INSERT INTO device_trusts(id,user_id,device_fingerprint,expires_at,ip_address)
    VALUES (gen_random_uuid(),'login-limit-user',$1,NOW()+INTERVAL '1 day','127.0.0.1')`,
    [createHash('sha256').update(deviceToken).digest('hex')]
  );
}, 40000);
afterEach(async () => {
  await http?.close();
}, 15000);

async function login(name = username, secret = 'wrong-password') {
  return fetchWithPreauth(`${http.base}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: `barghsa_device=${deviceToken}` },
    body: JSON.stringify({
      username: name,
      password: secret,
      deviceInfo: { fingerprint: 'known-device' },
    }),
    signal: AbortSignal.timeout(12000),
  });
}
async function count(key: string) {
  return Number(
    (
      await http.pool.query(
        'SELECT COALESCE(SUM(cardinality(events)),0) AS count FROM rate_limit_windows WHERE security AND key=$1',
        [key]
      )
    ).rows[0].count
  );
}

it('delays the sixth credential failure, isolates normalized accounts, and preserves the IP limit on success', async () => {
  for (let index = 0; index < 5; index++) expect((await login()).status).toBe(401);
  expect(await count(failureKey(username))).toBe(5);
  const started = performance.now();
  expect((await login('  LOGIN-LIMIT@EXAMPLE.TEST  ')).status).toBe(401);
  expect(performance.now() - started).toBeGreaterThanOrEqual(480);
  expect(await count(failureKey(username))).toBe(6);
  expect((await login('other-account@example.test')).status).toBe(401);
  expect(await count(failureKey('other-account@example.test'))).toBe(1);
  expect(await count(failureKey(username))).toBe(6);
  const successful = await login(username, password);
  expect(successful.status, (await successful.clone().text()) + http.logs()).toBe(200);
  expect(((await successful.json()) as { requiresOtp: boolean }).requiresOtp).toBe(false);
  expect(await count(failureKey(username))).toBe(0);
  expect(await count('login:ip:127.0.0.1')).toBe(8);
}, 20000);

it('atomically counts concurrent failures and expires the account delay window', async () => {
  const responses = await Promise.all(Array.from({ length: 6 }, () => login()));
  expect(responses.map((response) => response.status)).toEqual(Array(6).fill(401));
  expect(await count(failureKey(username))).toBe(6);
  await http.pool.query(
    'UPDATE rate_limit_windows SET events=ARRAY(SELECT t-1800000 FROM unnest(events) t) WHERE security AND key=$1',
    [failureKey(username)]
  );
  expect((await login()).status).toBe(401);
  const current = await http.pool.query(
    'SELECT cardinality(events) AS count FROM rate_limit_windows WHERE security AND key=$1',
    [failureKey(username)]
  );
  expect(Number(current.rows[0].count)).toBe(1);
}, 20000);

it('rejects a forced-password login if the credential changes before token issuance', async () => {
  await http.pool.query(
    "UPDATE users SET must_change_password=true WHERE user_id='login-limit-user'"
  );
  const replacement = await argon2.hash('Replacement-fixture-password-123!');
  const blocker = await http.pool.connect();
  let pending: Promise<Response> | undefined;
  try {
    await blocker.query('BEGIN');
    await blocker.query("SELECT user_id FROM users WHERE user_id='login-limit-user' FOR UPDATE");
    const { pid } = (await blocker.query<{ pid: number }>('SELECT pg_backend_pid() AS pid'))
      .rows[0]!;
    pending = login(username, password);
    await expect
      .poll(
        async () =>
          (
            await http.pool.query<{ count: number }>(
              `SELECT count(*)::int AS count FROM pg_stat_activity
         WHERE datname=current_database() AND $1=ANY(pg_blocking_pids(pid))
           AND query LIKE '%SET password_change_token =%'`,
              [pid]
            )
          ).rows[0]!.count,
        { timeout: 8000 }
      )
      .toBe(1);
    await blocker.query("UPDATE users SET password_hash=$1 WHERE user_id='login-limit-user'", [
      replacement,
    ]);
    await blocker.query('COMMIT');
    const denied = await pending;
    expect(denied.status).toBe(401);
    expect(await denied.json()).toMatchObject({ error: { code: 'AUTH:TOKEN_INVALID' } });
    expect(
      (
        await http.pool.query(
          "SELECT password_change_token,password_change_token_expires_at FROM users WHERE user_id='login-limit-user'"
        )
      ).rows
    ).toEqual([{ password_change_token: null, password_change_token_expires_at: null }]);
    expect((await http.pool.query('SELECT session_id FROM sessions')).rows).toEqual([]);
    expect((await http.pool.query('SELECT challenge_id FROM otp_challenges')).rows).toEqual([]);
  } finally {
    await blocker.query('ROLLBACK');
    blocker.release();
    await pending;
  }
}, 15000);

it('rolls back a trusted login and masks a failed session write', async () => {
  await http.pool
    .query(`CREATE FUNCTION reject_fixture_session() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN RAISE EXCEPTION 'fixture private session-write error'; END $$;
    CREATE TRIGGER reject_fixture_session BEFORE INSERT ON refresh_tokens FOR EACH ROW EXECUTE FUNCTION reject_fixture_session()`);
  const failed = await login(username, password);
  expect(failed.status).toBe(500);
  const response = await failed.text();
  expect(JSON.parse(response)).toMatchObject({ error: { code: 'INTERNAL:SERVER_ERROR' } });
  expect(response + http.logs()).not.toContain('fixture private session-write error');
  expect(failed.headers.get('Set-Cookie') ?? '').not.toContain('barghsa_session=');
  expect((await http.pool.query('SELECT session_id FROM sessions')).rows).toEqual([]);
  expect((await http.pool.query('SELECT id FROM refresh_tokens')).rows).toEqual([]);
  expect((await http.pool.query('SELECT challenge_id FROM otp_challenges')).rows).toEqual([]);
});

it('limits broad password spraying in PostgreSQL and returns Retry-After without counting a credential failure', async () => {
  const windowStart = Math.floor(Date.now() / 900000) * 900000;
  await http.pool.query(
    `INSERT INTO security_rate_limit_counters(key,window_start,window_ms,count)
    VALUES ('login:ip:127.0.0.1',$1,900000,50)`,
    [windowStart]
  );
  const response = await login(`spray-${randomUUID()}@example.test`);
  expect(response.status).toBe(429);
  expect(Number(response.headers.get('retry-after'))).toBeGreaterThan(0);
  const body = (await response.json()) as { error: { retryAfterSeconds: number; message: string } };
  expect(body.error.retryAfterSeconds).toBe(Number(response.headers.get('retry-after')));
  expect(body.error.message).toContain('seconds');
  expect(body.error.message).not.toContain('{seconds}');
  expect(
    (
      await http.pool.query(
        "SELECT count(*)::int AS count FROM rate_limit_windows WHERE security AND key LIKE 'login:failures:%'"
      )
    ).rows[0].count
  ).toBe(0);
});

it('preserves service-level OTP retry timing and localizes it for Persian clients', async () => {
  await http.pool.query(
    `INSERT INTO security_rate_limit_counters(key,window_start,window_ms,count)
    VALUES ($1,$2,60000,1)`,
    [`otp:dest:${username}:60s`, Math.floor(Date.now() / 60000) * 60000]
  );
  const response = await fetchWithPreauth(`${http.base}/api/auth/forgot-password`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Accept-Language': 'fa' },
    body: JSON.stringify({ username }),
  });
  expect(response.status).toBe(429);
  const body = (await response.json()) as { error: { retryAfterSeconds: number; message: string } };
  expect(body.error.retryAfterSeconds).toBe(Number(response.headers.get('retry-after')));
  expect(body.error.retryAfterSeconds).toBeGreaterThan(0);
  expect(body.error.message).toContain('ثانیه');
  expect(body.error.message).not.toContain('{seconds}');
});

it('enforces destination starts and device spraying independently of the IP counter', async () => {
  const hourly = Math.floor(Date.now() / 3600000) * 3600000;
  const destination = createHash('sha256').update(username).digest('hex');
  await http.pool.query(
    `INSERT INTO security_rate_limit_counters(key,window_start,window_ms,count)
    VALUES ($1,$3,3600000,5),($2,$3,3600000,10)`,
    [`password-reset:destination:${destination}`, `registration:destination:${destination}`, hourly]
  );
  for (const [route, body] of [
    ['forgot-password', { username }],
    ['register', { username, password, tosVersionId: 'unpublished-test-terms' }],
  ] as const) {
    const response = await fetchWithPreauth(`${http.base}/api/auth/${route}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    expect(response.status, await response.clone().text()).toBe(429);
    expect(Number(response.headers.get('retry-after'))).toBeGreaterThan(0);
  }
  expect(
    (await http.pool.query('SELECT count(*)::int AS count FROM otp_challenges')).rows[0].count
  ).toBe(0);
  await http.pool.query(
    `INSERT INTO security_rate_limit_counters(key,window_start,window_ms,count)
    VALUES ($1,$2,900000,50)`,
    [
      'login:device:' + createHash('sha256').update(deviceToken).digest('hex'),
      Math.floor(Date.now() / 900000) * 900000,
    ]
  );
  expect((await login()).status).toBe(429);
  expect(await count('login:ip:127.0.0.1')).toBe(1);
  expect(await count(failureKey(username))).toBe(0);
});
