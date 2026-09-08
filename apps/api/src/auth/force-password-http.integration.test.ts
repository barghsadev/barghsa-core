import { fetchWithPreauth } from '../test/public-auth.js';
import { afterEach, beforeAll, beforeEach, expect, it } from 'vitest';
import { createHash, randomUUID } from 'node:crypto';
import * as argon2 from 'argon2';
import { startHttpFixture } from '../test/http-fixture.js';

let http: Awaited<ReturnType<typeof startHttpFixture>>;
let token: string;
let sessionId: string;
let currentHash: string;
let oldHashes: string[];
const currentPassword = 'Current-password-123!';
const newPassword = 'Changed-password-456!';
const oldPasswords = Array.from({ length: 6 }, (_, i) => `Previous-password-${i + 1}!`);

beforeAll(async () => {
  currentHash = await argon2.hash(currentPassword);
  oldHashes = [];
  for (const password of oldPasswords) oldHashes.push(await argon2.hash(password));
});
beforeEach(async () => {
  if (!process.env.TEST_DATABASE_URL) throw new Error('PostgreSQL setup did not run');
  http = await startHttpFixture(process.env.TEST_DATABASE_URL);
  token = randomUUID();
  sessionId = randomUUID();
  await http.pool.query(
    `INSERT INTO users(user_id,username,password_hash,must_change_password,password_change_token,password_change_token_expires_at)
     VALUES ('forced-user','forced@example.test',$1,true,$2,NOW()+INTERVAL '5 minutes')`,
    [currentHash, token]
  );
  await http.pool.query(
    `INSERT INTO sessions(session_id,user_id,csrf_token,family_id,expires_at,idle_deadline)
     VALUES ($1,'forced-user','fixture-csrf',$2,NOW()+INTERVAL '1 day',NOW()+INTERVAL '30 minutes')`,
    [sessionId, randomUUID()]
  );
  await http.pool.query(
    `INSERT INTO refresh_tokens(id,user_id,session_id,family_id,token_hash)
     SELECT $1,user_id,session_id,family_id,$2 FROM sessions WHERE session_id=$3`,
    [randomUUID(), createHash('sha256').update('fixture-refresh').digest('hex'), sessionId]
  );
}, 40000);
afterEach(async () => {
  await http?.close();
}, 15000);

async function post(path: string, body: unknown) {
  return fetchWithPreauth(`${http.base}/api/auth/${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(10000),
  });
}
const change = (password = newPassword) =>
  post('force-change-password', { passwordChangeToken: token, newPassword: password });
async function state() {
  const tables = [
    'users',
    'sessions',
    'refresh_tokens',
    'password_history',
    'device_trusts',
    'audit_log',
  ];
  return Object.fromEntries(
    await Promise.all(
      tables.map(async (table) => [
        table,
        (await http.pool.query(`SELECT * FROM ${table} ORDER BY 1`)).rows,
      ])
    )
  );
}

it('issues only a password-change token after correct credentials, invalidates the prior token and creates no session', async () => {
  expect(
    (await post('login', { username: 'forced@example.test', password: 'wrong-password' })).status
  ).toBe(401);
  const login = await post('login', { username: 'forced@example.test', password: currentPassword });
  expect(login.status).toBe(200);
  const body = (await login.json()) as { mustChangePassword: boolean; passwordChangeToken: string };
  expect(body).toMatchObject({ mustChangePassword: true, passwordChangeToken: expect.any(String) });
  expect(login.headers.get('set-cookie')).not.toContain('barghsa_session=');
  expect((await change()).status).toBe(400);
  const snapshot = await state();
  expect(snapshot.sessions).toHaveLength(1);
  expect(snapshot.users[0].password_hash).toBe(currentHash);
  expect(snapshot.users[0].password_change_token).toBe(body.passwordChangeToken);
  expect(snapshot.users[0].password_change_token_expires_at.getTime() - Date.now()).toBeGreaterThan(
    240000
  );
  expect(
    snapshot.users[0].password_change_token_expires_at.getTime() - Date.now()
  ).toBeLessThanOrEqual(300000);
});

it.each(['Short1A', 'lowercase12345', 'UPPERCASE12345', 'NoNumericValue', 'Aa1' + 'x'.repeat(126)])(
  'rejects a password outside the required strength policy: %s',
  async (password) => {
    const before = await state();
    expect((await change(password)).status).toBe(422);
    expect(await state()).toEqual(before);
  }
);

it('rejects the current and last five passwords but permits an older one, preserving ordered history', async () => {
  for (let i = 0; i < oldHashes.length; i++)
    await http.pool.query(
      'INSERT INTO password_history(id,user_id,password_hash,version) VALUES ($1,$2,$3,$4)',
      [randomUUID(), 'forced-user', oldHashes[i], i + 1]
    );
  const before = await state();
  for (const password of [currentPassword, oldPasswords[1]!, oldPasswords[5]!]) {
    expect((await change(password)).status).toBe(422);
    expect(await state()).toEqual(before);
  }
  expect((await change(oldPasswords[0]!)).status).toBe(200);
  expect(
    (await http.pool.query('SELECT version,password_hash FROM password_history ORDER BY version'))
      .rows
  ).toEqual([
    ...oldHashes.map((password_hash, i) => ({ version: i + 1, password_hash })),
    { version: 7, password_hash: currentHash },
  ]);
});

it.each(['missing-expiry', 'expired', 'disabled', 'cleared-flag'] as const)(
  'rejects unusable authorization without credential changes: %s',
  async (kind) => {
    if (kind === 'missing-expiry')
      await http.pool.query(
        "UPDATE users SET password_change_token_expires_at=NULL WHERE user_id='forced-user'"
      );
    if (kind === 'expired')
      await http.pool.query(
        "UPDATE users SET password_change_token_expires_at=NOW()-INTERVAL '1 second' WHERE user_id='forced-user'"
      );
    if (kind === 'disabled' || kind === 'cleared-flag') {
      token = randomUUID();
      await http.pool.query(
        kind === 'disabled'
          ? "UPDATE users SET disabled_at=NOW(),password_change_token=$1 WHERE user_id='forced-user'"
          : "UPDATE users SET must_change_password=false,password_change_token=$1 WHERE user_id='forced-user'",
        [token]
      );
    }
    const before = await state();
    expect((await change()).status).toBe(400);
    expect(await state()).toEqual(before);
  }
);

it('refuses an unverifiable history entry instead of treating it as an unused password', async () => {
  await http.pool.query(
    "INSERT INTO password_history(id,user_id,password_hash,version) VALUES ($1,'forced-user','malformed-history',1)",
    [randomUUID()]
  );
  const before = await state();
  const response = await change();
  expect(response.status).toBe(500);
  expect(await response.text()).not.toContain('malformed-history');
  expect(await state()).toEqual(before);
});

it('rolls back audit failure, then commits only one concurrent change and invalidates old credentials', async () => {
  const challengeId = randomUUID();
  await http.pool.query(
    `INSERT INTO otp_challenges(challenge_id,destination,otp_hash,expires_at,purpose,user_id)
     VALUES ($1,'forced@example.test',$2,NOW()+INTERVAL '5 minutes','login','forced-user')`,
    [challengeId, createHash('sha256').update('123456').digest('hex')]
  );
  await http.pool.query(`CREATE FUNCTION reject_password_audit() RETURNS trigger AS $$
    BEGIN IF NEW.event='password_changed' THEN RAISE EXCEPTION 'controlled password audit failure'; END IF; RETURN NEW; END; $$ LANGUAGE plpgsql;
    CREATE TRIGGER reject_password_audit BEFORE INSERT ON audit_log FOR EACH ROW EXECUTE FUNCTION reject_password_audit();`);
  const before = await state();
  const failed = await change();
  expect(failed.status).toBe(500);
  expect(await failed.text()).not.toContain('controlled password audit failure');
  expect(await state()).toEqual(before);
  await http.pool.query('DROP TRIGGER reject_password_audit ON audit_log');
  const responses = await Promise.all([change(), change()]);
  expect(responses.map((r) => r.status).sort()).toEqual([200, 400]);
  for (const response of responses)
    expect(response.headers.getSetCookie()).toEqual([expect.stringMatching(/^barghsa_preauth=;/)]);
  const after = await state();
  expect(after.users[0]).toMatchObject({
    must_change_password: false,
    password_change_token: null,
    password_change_token_expires_at: null,
  });
  expect(await argon2.verify(after.users[0].password_hash, newPassword)).toBe(true);
  expect(await argon2.verify(after.users[0].password_hash, currentPassword)).toBe(false);
  expect(after.sessions).toHaveLength(1);
  expect(after.sessions[0].revoked_at).not.toBeNull();
  expect(after.refresh_tokens[0].consumed_at).not.toBeNull();
  expect(after.password_history).toHaveLength(1);
  expect(after.audit_log).toHaveLength(1);
  expect(after.audit_log[0]).toMatchObject({
    event: 'password_changed',
    user_id: 'forced-user',
    correlation_id: expect.any(String),
    metadata: JSON.stringify({ reason: 'forced_change' }),
  });
  for (const secret of [token, currentHash, newPassword, after.users[0].password_hash])
    expect(JSON.stringify(after.audit_log)).not.toContain(secret);
  expect((await post('login/verify', { challengeId, otp: '123456' })).status).toBe(401);
  expect((await change()).status).toBe(400);
});

it.each(['account', 'session'] as const)(
  'rolls back if the password-change token expires while waiting for %s',
  async (resource) => {
    await http.pool.query(
      "UPDATE users SET password_change_token_expires_at=clock_timestamp()+INTERVAL '3 seconds' WHERE user_id='forced-user'"
    );
    const before = await state();
    const lock = await http.pool.connect();
    let changing: Promise<Response> | undefined;
    try {
      await lock.query('BEGIN');
      const pid = (await lock.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;
      if (resource === 'account')
        await lock.query("SELECT user_id FROM users WHERE user_id='forced-user' FOR UPDATE");
      else
        await lock.query('SELECT session_id FROM sessions WHERE session_id=$1 FOR UPDATE', [
          sessionId,
        ]);
      changing = change();
      await expect
        .poll(
          async () =>
            (
              await http.pool.query(
                'SELECT count(*)::int AS count FROM pg_stat_activity WHERE datname=current_database() AND $1=ANY(pg_blocking_pids(pid))',
                [pid]
              )
            ).rows[0].count
        )
        .toBe(1);
      await expect
        .poll(
          async () =>
            (
              await http.pool.query(
                "SELECT password_change_token_expires_at<=clock_timestamp() AS expired FROM users WHERE user_id='forced-user'"
              )
            ).rows[0].expired,
          { timeout: 6000 }
        )
        .toBe(true);
      await lock.query('COMMIT');
      const response = await changing;
      expect(response.status, await response.clone().text()).toBe(400);
      expect(await state()).toEqual(before);
    } finally {
      await lock.query('ROLLBACK');
      lock.release();
      await changing;
    }
  },
  15000
);
