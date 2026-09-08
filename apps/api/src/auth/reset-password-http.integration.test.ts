import { afterEach, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import { createHash, randomUUID } from 'node:crypto';
import * as argon2 from 'argon2';
import type { QueryResultRow } from 'pg';
import { startHttpFixture } from '../test/http-fixture.js';

let http: Awaited<ReturnType<typeof startHttpFixture>>;
let challengeId: string;
let sessionId: string;
let currentHash: string;
let oldHashes: string[];
const password = 'Current-reset-password-123!';
const replacement = 'Changed-reset-password-456!';
const previous = Array.from({ length: 6 }, (_, i) => `Previous-reset-password-${i + 1}!`);
const digest = (value: string) => createHash('sha256').update(value).digest('hex');

beforeAll(async () => {
  currentHash = await argon2.hash(password);
  oldHashes = [];
  for (const value of previous) oldHashes.push(await argon2.hash(value));
});
beforeEach(async () => {
  if (!process.env.TEST_DATABASE_URL) throw new Error('PostgreSQL setup did not run');
  vi.stubEnv('AUTH_DELIVERY_ENCRYPTION_KEY', 'reset-stage-test-key');
  vi.stubEnv('DB_POOL_MIN', '1');
  vi.stubEnv('DB_POOL_MAX', '1');
  // The app gets one connection; observers keep their independent default pool.
  // Trust only the local proxy to exercise real destination limits across IPs.
  http = await startHttpFixture(process.env.TEST_DATABASE_URL, undefined, '127.0.0.1,::1');
  await http.pool.query(
    "INSERT INTO users(user_id,username,password_hash) VALUES ('reset-user','reset@example.test',$1),('unrelated-user','other@example.test',$1)",
    [currentHash]
  );
  sessionId = randomUUID();
  for (const [id, user] of [
    [sessionId, 'reset-user'],
    [randomUUID(), 'reset-user'],
    [randomUUID(), 'unrelated-user'],
  ]) {
    await http.pool.query(
      `INSERT INTO sessions(session_id,user_id,csrf_token,family_id,expires_at,idle_deadline)
       VALUES ($1,$2,'fixture-csrf',$3,NOW()+INTERVAL '1 day',NOW()+INTERVAL '30 minutes')`,
      [id, user, randomUUID()]
    );
    await http.pool.query(
      `INSERT INTO refresh_tokens(id,user_id,session_id,family_id,token_hash)
       SELECT $1,user_id,session_id,family_id,$2 FROM sessions WHERE session_id=$3`,
      [randomUUID(), digest(id!), id]
    );
  }
  challengeId = await challenge();
}, 40000);
afterEach(async () => {
  try {
    await http?.close();
  } finally {
    vi.unstubAllEnvs();
  }
}, 15000);

async function challenge(user = 'reset-user') {
  const id = randomUUID();
  await http.pool.query(
    `INSERT INTO otp_challenges(challenge_id,destination,otp_hash,expires_at,purpose,user_id,auth_version)
     SELECT $1,username,$2,NOW()+INTERVAL '5 minutes','password_reset',user_id,auth_version FROM users WHERE user_id=$3`,
    [id, digest('123456'), user]
  );
  return id;
}
function reset(newPassword = replacement, otp = '123456', id = challengeId, ip = '192.0.2.1') {
  return fetch(`${http.base}/api/auth/reset-password`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': ip },
    body: JSON.stringify({ challengeId: id, otp, newPassword }),
    signal: AbortSignal.timeout(12000),
  });
}
async function state() {
  // Rate counters intentionally survive rejected transactions.
  const tables = [
    'users',
    'otp_challenges',
    'sessions',
    'refresh_tokens',
    'password_history',
    'device_trusts',
    'audit_log',
  ] as const;
  return Object.fromEntries(
    await Promise.all(
      tables.map(
        async (table) =>
          [table, (await http.pool.query(`SELECT * FROM ${table} ORDER BY 1`)).rows] as const
      )
    )
  ) as Record<(typeof tables)[number], QueryResultRow[]>;
}

it.each(['Short1A', 'lowercase12345', 'UPPERCASE12345', 'NoNumericValue', 'Aa1' + 'x'.repeat(126)])(
  'rejects a password outside the required strength policy: %s',
  async (value) => {
    const before = await state();
    expect((await reset(value)).status).toBe(422);
    expect(await state()).toEqual(before);
  }
);

it('enforces the current and latest five passwords and preserves ordered history', async () => {
  for (let i = 0; i < oldHashes.length; i++)
    await http.pool.query(
      'INSERT INTO password_history(id,user_id,password_hash,version) VALUES ($1,$2,$3,$4)',
      [randomUUID(), 'reset-user', oldHashes[i], i + 1]
    );
  const before = await state();
  for (const value of [password, previous[1]!, previous[5]!]) {
    expect((await reset(value)).status).toBe(422);
    expect(await state()).toEqual(before);
  }
  expect((await reset(previous[0]!)).status).toBe(200);
  expect(
    (await http.pool.query('SELECT version,password_hash FROM password_history ORDER BY version'))
      .rows
  ).toEqual([
    ...oldHashes.map((password_hash, i) => ({ version: i + 1, password_hash })),
    { version: 7, password_hash: currentHash },
  ]);
});

it.each(['current', 'history'])(
  'aborts if the %s password hash cannot be verified',
  async (kind) => {
    if (kind === 'history') {
      await http.pool.query(
        "INSERT INTO password_history(id,user_id,password_hash,version) VALUES ($1,'reset-user','unreadable-history',1)",
        [randomUUID()]
      );
    } else {
      await http.pool.query(
        "UPDATE users SET password_hash='unreadable-current' WHERE user_id='reset-user'"
      );
      challengeId = await challenge();
    }
    const before = await state();
    const response = await reset();
    expect(response.status).toBe(500);
    expect(await response.text()).not.toContain('unreadable-');
    expect(response.headers.getSetCookie()).toEqual([]);
    expect(await state()).toEqual(before);
  }
);

it('rolls back audit failure, then commits one concurrent reset and revokes only that user', async () => {
  const staleLogin = randomUUID();
  await http.pool.query(
    `INSERT INTO otp_challenges(challenge_id,destination,otp_hash,expires_at,purpose,user_id,auth_version)
     SELECT $1,username,$2,NOW()+INTERVAL '5 minutes','login',user_id,auth_version FROM users WHERE user_id='reset-user'`,
    [staleLogin, digest('123456')]
  );
  await http.pool.query(`CREATE FUNCTION reject_reset_audit() RETURNS trigger AS $$
    BEGIN IF NEW.event='password_reset' THEN RAISE EXCEPTION 'controlled reset audit failure'; END IF; RETURN NEW; END; $$ LANGUAGE plpgsql;
    CREATE TRIGGER reject_reset_audit BEFORE INSERT ON audit_log FOR EACH ROW EXECUTE FUNCTION reject_reset_audit();`);
  const before = await state();
  const failed = await reset();
  expect(failed.status).toBe(500);
  expect(await failed.text()).not.toContain('controlled reset audit failure');
  expect(failed.headers.getSetCookie()).toEqual([]);
  expect(await state()).toEqual(before);
  await http.pool.query('DROP TRIGGER reject_reset_audit ON audit_log');
  const responses = await Promise.all([reset(), reset()]);
  expect(responses.map((r) => r.status).sort()).toEqual([200, 409]);
  for (const response of responses) expect(response.headers.getSetCookie()).toEqual([]);
  const success = responses.find((r) => r.status === 200)!;
  const after = await state();
  expect(
    await argon2.verify(
      after.users.find((u) => u.user_id === 'reset-user')!.password_hash,
      replacement
    )
  ).toBe(true);
  expect(after.password_history).toHaveLength(1);
  expect(after.sessions.filter((s) => s.user_id === 'reset-user')).toHaveLength(2);
  expect(after.sessions.filter((s) => s.user_id === 'reset-user').every((s) => s.revoked_at)).toBe(
    true
  );
  expect(
    after.refresh_tokens.filter((s) => s.user_id === 'reset-user').every((s) => s.consumed_at)
  ).toBe(true);
  for (const table of ['users', 'sessions', 'refresh_tokens'] as const)
    expect(after[table].filter((row) => row.user_id === 'unrelated-user')).toEqual(
      before[table].filter((row) => row.user_id === 'unrelated-user')
    );
  expect(after.audit_log).toHaveLength(1);
  expect(after.audit_log[0]).toMatchObject({
    event: 'password_reset',
    user_id: 'reset-user',
    metadata: null,
    correlation_id: success.headers.get('x-correlation-id'),
    ip: '192.0.2.1',
  });
  for (const secret of [password, replacement, currentHash, challengeId, '123456'])
    expect(JSON.stringify(after.audit_log)).not.toContain(secret);
  expect(
    (
      await fetch(`${http.base}/api/auth/sessions`, {
        headers: { Cookie: `barghsa_session=${sessionId}` },
      })
    ).status
  ).toBe(401);
  const stale = await fetch(`${http.base}/api/auth/login/verify`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ challengeId: staleLogin, otp: '123456' }),
  });
  expect(stale.status).toBe(401);
});

it.each(['account', 'session', 'refresh', 'audit'] as const)(
  'rolls back every credential change if OTP expiry passes while waiting for %s',
  async (resource) => {
    await http.pool.query(
      "UPDATE otp_challenges SET expires_at=clock_timestamp()+INTERVAL '2 seconds' WHERE challenge_id=$1",
      [challengeId]
    );
    const before = await state();
    const lock = await http.pool.connect();
    let changing: Promise<Response> | undefined;
    try {
      await lock.query('BEGIN');
      const pid = (await lock.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;
      if (resource === 'account')
        await lock.query("SELECT user_id FROM users WHERE user_id='reset-user' FOR UPDATE");
      else if (resource === 'session')
        await lock.query('SELECT session_id FROM sessions WHERE session_id=$1 FOR UPDATE', [
          sessionId,
        ]);
      else
        await lock.query(
          `LOCK TABLE ${resource === 'refresh' ? 'refresh_tokens' : 'audit_log'} IN SHARE MODE`
        );
      changing = reset();
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
                'SELECT expires_at<=clock_timestamp() AS expired FROM otp_challenges WHERE challenge_id=$1',
                [challengeId]
              )
            ).rows[0].expired,
          { timeout: 5000 }
        )
        .toBe(true);
      await lock.query('COMMIT');
      const response = await changing;
      expect(response.status, await response.clone().text()).toBe(401);
      expect(await response.text()).toContain('AUTH:OTP:EXPIRED');
      expect(response.headers.getSetCookie()).toEqual([]);
      expect(await state()).toEqual(before);
    } finally {
      await lock.query('ROLLBACK');
      lock.release();
      await changing;
    }
  },
  15000
);

it('shares five reset attempts across challenges and source IPs while keeping destinations independent', async () => {
  const challenges = await Promise.all(Array.from({ length: 6 }, () => challenge()));
  for (let i = 0; i < 5; i++) {
    const response = await reset(replacement, '654321', challenges[i], `192.0.2.${i + 1}`);
    expect(response.status, await response.clone().text()).toBe(401);
  }
  const limited = await reset(replacement, '123456', challenges[5], '192.0.2.6');
  expect(limited.status).toBe(429);
  expect(await limited.text()).toContain('RATE_LIMIT:EXCEEDED');
  const row = (
    await http.pool.query(
      'SELECT attempts_remaining,consumed_at FROM otp_challenges WHERE challenge_id=$1',
      [challenges[5]]
    )
  ).rows[0];
  expect(row).toEqual({ attempts_remaining: 5, consumed_at: null });
  expect(
    (await reset(replacement, '654321', await challenge('unrelated-user'), '192.0.2.6')).status
  ).toBe(401);
  expect(
    (await http.pool.query("SELECT password_hash FROM users WHERE user_id='reset-user'")).rows[0]
      .password_hash
  ).toBe(currentHash);
});

function verifyReset(otp = '123456', id = challengeId, ip = '192.0.2.1') {
  return fetch(`${http.base}/api/auth/reset-password/verify`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': ip },
    body: JSON.stringify({ challengeId: id, otp }),
    signal: AbortSignal.timeout(12000),
  });
}
function completeReset(
  resetToken: string,
  newPassword = replacement,
  id = challengeId,
  ip = '192.0.2.1'
) {
  return fetch(`${http.base}/api/auth/reset-password`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': ip },
    body: JSON.stringify({ challengeId: id, resetToken, newPassword }),
    signal: AbortSignal.timeout(12000),
  });
}
async function authorization() {
  const response = await verifyReset();
  const body = (await response.json()) as {
    verified: boolean;
    challengeId: string;
    resetToken: string;
    expiresAt: string;
  };
  expect(response.status, JSON.stringify(body)).toBe(200);
  expect(response.headers.get('cache-control')?.split(/,\s*/)).toContain('no-store');
  expect(response.headers.getSetCookie()).toEqual([]);
  expect(body).toMatchObject({
    verified: true,
    challengeId,
    resetToken: expect.stringMatching(/^[a-f0-9]{64}$/),
  });
  return { response, ...body };
}

it('exchanges OTP once for a hashed grant with the original deadline and private correlated audit', async () => {
  const before = await state();
  const grant = await authorization();
  const after = await state();
  expect(after.otp_challenges[0]).toMatchObject({
    consumed_at: expect.any(Date),
    attempts_remaining: 0,
    reset_token_hash: digest(grant.resetToken),
    reset_consumed_at: null,
    expires_at: before.otp_challenges[0]!.expires_at,
  });
  expect(grant.expiresAt).toBe(before.otp_challenges[0]!.expires_at.toISOString());
  for (const table of [
    'users',
    'sessions',
    'refresh_tokens',
    'password_history',
    'device_trusts',
  ] as const)
    expect(after[table]).toEqual(before[table]);
  expect(after.audit_log).toHaveLength(1);
  expect(after.audit_log[0]).toMatchObject({
    event: 'password_reset_verified',
    user_id: 'reset-user',
    metadata: null,
    correlation_id: grant.response.headers.get('x-correlation-id'),
  });
  for (const secret of ['123456', grant.resetToken, challengeId])
    expect(JSON.stringify(after.audit_log)).not.toContain(secret);
  expect((await verifyReset()).status).toBe(409);
  expect((await reset()).status).toBe(409);
  expect((await completeReset('f'.repeat(64))).status).toBe(401);
  expect(await state()).toEqual(after);
  expect((await completeReset(grant.resetToken)).status).toBe(200);
  expect((await completeReset(grant.resetToken)).status).toBe(409);
});

it('rolls back OTP consumption and grant creation if the verification audit fails', async () => {
  await http.pool.query(`CREATE FUNCTION reject_verification_audit() RETURNS trigger AS $$
    BEGIN IF NEW.event='password_reset_verified' THEN RAISE EXCEPTION 'controlled audit failure'; END IF; RETURN NEW; END; $$ LANGUAGE plpgsql;
    CREATE TRIGGER reject_verification_audit BEFORE INSERT ON audit_log FOR EACH ROW EXECUTE FUNCTION reject_verification_audit();`);
  const before = await state();
  const response = await verifyReset();
  expect(response.status).toBe(500);
  expect(await response.text()).not.toContain('controlled');
  expect(await state()).toEqual(before);
  await http.pool.query('DROP TRIGGER reject_verification_audit ON audit_log');
  await authorization();
});

it('preserves a grant on history/audit rejection, then commits only one concurrent completion', async () => {
  const grant = await authorization();
  const before = await state();
  expect((await completeReset(grant.resetToken, password)).status).toBe(422);
  expect(await state()).toEqual(before);
  await http.pool.query(`CREATE FUNCTION reject_grant_audit() RETURNS trigger AS $$
    BEGIN IF NEW.event='password_reset' THEN RAISE EXCEPTION 'controlled audit failure'; END IF; RETURN NEW; END; $$ LANGUAGE plpgsql;
    CREATE TRIGGER reject_grant_audit BEFORE INSERT ON audit_log FOR EACH ROW EXECUTE FUNCTION reject_grant_audit();`);
  expect((await completeReset(grant.resetToken)).status).toBe(500);
  expect(await state()).toEqual(before);
  await http.pool.query('DROP TRIGGER reject_grant_audit ON audit_log');
  const responses = await Promise.all([
    completeReset(grant.resetToken),
    completeReset(grant.resetToken),
  ]);
  expect(responses.map((r) => r.status).sort()).toEqual([200, 409]);
  const after = await state();
  expect(after.password_history).toHaveLength(1);
  expect(
    await argon2.verify(
      after.users.find((u) => u.user_id === 'reset-user')!.password_hash,
      replacement
    )
  ).toBe(true);
  for (const table of ['sessions', 'refresh_tokens'] as const) {
    expect(after[table].filter((r) => r.user_id === 'unrelated-user')).toEqual(
      before[table].filter((r) => r.user_id === 'unrelated-user')
    );
    expect(
      after[table]
        .filter((r) => r.user_id === 'reset-user')
        .every((r) => (table === 'sessions' ? r.revoked_at : r.consumed_at))
    ).toBe(true);
  }
  expect(after.audit_log.filter((r) => r.event === 'password_reset')).toHaveLength(1);
  expect(after.otp_challenges[0]!.reset_consumed_at).toBeInstanceOf(Date);
});

it('permits the fifth correct OTP and subsequent reset without double-charging verification quota', async () => {
  for (let i = 0; i < 4; i++)
    expect((await verifyReset('654321', challengeId, `192.0.2.${i + 1}`)).status).toBe(401);
  const grant = await authorization();
  expect((await completeReset(grant.resetToken)).status).toBe(200);
  expect((await verifyReset('123456', await challenge(), '192.0.2.9')).status).toBe(429);
});

it('limits grant completion to five attempts per destination across source IPs', async () => {
  const grant = await authorization();
  const before = await state();
  for (let i = 0; i < 5; i++)
    expect(
      (await completeReset('e'.repeat(64), replacement, challengeId, `192.0.2.${i + 1}`)).status
    ).toBe(401);
  expect(
    (await completeReset(grant.resetToken, replacement, challengeId, '192.0.2.9')).status
  ).toBe(429);
  expect(await state()).toEqual(before);
});

it.each(['password', 'disabled'] as const)(
  'rejects grants after the account %s changes',
  async (kind) => {
    const grant = await authorization();
    await http.pool.query(
      kind === 'password'
        ? "UPDATE users SET password_hash='changed-outside-reset' WHERE user_id='reset-user'"
        : "UPDATE users SET disabled_at=NOW() WHERE user_id='reset-user'"
    );
    const before = await state();
    expect((await completeReset(grant.resetToken)).status).toBe(kind === 'password' ? 401 : 403);
    expect(await state()).toEqual(before);
  }
);

it('new reset issuance atomically replaces old grants without revoking sessions or changing auth version', async () => {
  const grant = await authorization();
  const before = await state();
  const response = await fetch(`${http.base}/api/auth/forgot-password`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'reset@example.test' }),
  });
  expect(response.status, await response.clone().text()).toBe(200);
  const body = (await response.json()) as { challengeId: string };
  const after = await state();
  const account = after.users.find((u) => u.user_id === 'reset-user')!;
  expect(account.password_reset_challenge_id).toBe(body.challengeId);
  expect(account.auth_version).toBe(
    before.users.find((u) => u.user_id === 'reset-user')!.auth_version
  );
  expect(after.sessions).toEqual(before.sessions);
  expect(
    (
      await http.pool.query(
        'SELECT count(*)::int AS count FROM auth_delivery_outbox WHERE challenge_id=$1',
        [body.challengeId]
      )
    ).rows[0].count
  ).toBe(1);
  expect((await completeReset(grant.resetToken)).status).toBe(401);
  expect(await state()).toEqual(after);
  // A deterministic code stands in for the delivered code; delivery adapters have their own HTTP fixture coverage.
  await http.pool.query('UPDATE otp_challenges SET otp_hash=$1 WHERE challenge_id=$2', [
    digest('123456'),
    body.challengeId,
  ]);
  expect((await verifyReset('123456', body.challengeId)).status).toBe(200);
});

it.each(['account', 'session', 'refresh', 'audit'] as const)(
  'rolls back grant completion after expiry while waiting for %s',
  async (resource) => {
    const grant = await authorization();
    await http.pool.query(
      "UPDATE otp_challenges SET expires_at=clock_timestamp()+INTERVAL '2 seconds' WHERE challenge_id=$1",
      [challengeId]
    );
    const before = await state();
    const lock = await http.pool.connect();
    let changing: Promise<Response> | undefined;
    try {
      await lock.query('BEGIN');
      const pid = (await lock.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;
      if (resource === 'account')
        await lock.query("SELECT user_id FROM users WHERE user_id='reset-user' FOR UPDATE");
      else if (resource === 'session')
        await lock.query('SELECT session_id FROM sessions WHERE session_id=$1 FOR UPDATE', [
          sessionId,
        ]);
      else
        await lock.query(
          `LOCK TABLE ${resource === 'refresh' ? 'refresh_tokens' : 'audit_log'} IN SHARE MODE`
        );
      changing = completeReset(grant.resetToken);
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
                'SELECT expires_at<=clock_timestamp() AS expired FROM otp_challenges WHERE challenge_id=$1',
                [challengeId]
              )
            ).rows[0].expired,
          { timeout: 5000 }
        )
        .toBe(true);
      await lock.query('COMMIT');
      const response = await changing;
      expect(response.status, await response.clone().text()).toBe(401);
      expect(await state()).toEqual(before);
    } finally {
      await lock.query('ROLLBACK');
      lock.release();
      await changing;
    }
  },
  15000
);

it('keeps disabled and unknown reset destinations indistinguishable without queuing a challenge', async () => {
  await http.pool.query("UPDATE users SET disabled_at=NOW() WHERE user_id='reset-user'");
  const before = await state();
  for (const username of ['reset@example.test', 'unknown@example.test']) {
    const response = await fetch(`${http.base}/api/auth/forgot-password`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username }),
    });
    expect(response.status, await response.clone().text()).toBe(200);
    expect(await response.json()).toEqual({
      challengeId: expect.stringMatching(/^[a-f0-9-]{36}$/),
      sent: true,
      message: 'If an account exists, a verification code has been queued.',
    });
  }
  expect(await state()).toEqual(before);
  expect(
    (await http.pool.query('SELECT count(*)::int AS count FROM auth_delivery_outbox')).rows[0].count
  ).toBe(0);
});

it('keeps the old grant valid if replacement delivery cannot be queued atomically', async () => {
  const grant = await authorization();
  const before = await state();
  await http.pool.query(`CREATE FUNCTION reject_reset_delivery() RETURNS trigger AS $$
    BEGIN RAISE EXCEPTION 'controlled outbox failure'; END; $$ LANGUAGE plpgsql;
    CREATE TRIGGER reject_reset_delivery BEFORE INSERT ON auth_delivery_outbox FOR EACH ROW EXECUTE FUNCTION reject_reset_delivery();`);
  const response = await fetch(`${http.base}/api/auth/forgot-password`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'reset@example.test' }),
  });
  expect(response.status).toBe(500);
  expect(await response.text()).not.toContain('controlled');
  expect(await state()).toEqual(before);
  expect((await completeReset(grant.resetToken)).status).toBe(200);
});
