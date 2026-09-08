import { afterEach, beforeEach, expect, it } from 'vitest';
import { createHash, randomUUID } from 'node:crypto';
import * as argon2 from 'argon2';
import { startHttpFixture } from '../test/http-fixture.js';

let http: Awaited<ReturnType<typeof startHttpFixture>>;
let session: string, csrf: string, own: string, other: string;
const token = 'a'.repeat(64);
const fingerprint = createHash('sha256').update(token).digest('hex');
const password = 'Trusted-device-test-password-123!';
const headers = () => ({
  Cookie: `barghsa_session=${session}; barghsa_device=${token}`,
  'X-CSRF-Token': csrf,
});
const endpoint = (id = own) => `${http.base}/api/auth/trusted-devices/${id}`;

beforeEach(async () => {
  if (!process.env.TEST_DATABASE_URL) throw new Error('PostgreSQL setup did not run');
  http = await startHttpFixture(process.env.TEST_DATABASE_URL);
  session = randomUUID();
  csrf = randomUUID();
  own = randomUUID();
  other = randomUUID();
  await http.pool.query(
    "INSERT INTO users(user_id,username,password_hash) VALUES ('trust-owner','trust@example.test',$1),('trust-other','other@example.test','fixture-only')",
    [await argon2.hash(password)]
  );
  await http.pool.query(
    `INSERT INTO sessions(session_id,user_id,csrf_token,expires_at,idle_deadline,step_up_verified_at)
    VALUES ($1,'trust-owner',$2,NOW()+INTERVAL '1 day',NOW()+INTERVAL '30 minutes',NOW())`,
    [session, csrf]
  );
  await http.pool.query(
    `INSERT INTO device_trusts(id,user_id,device_fingerprint,user_agent_hint,ip_address,expires_at)
    VALUES ($1,'trust-owner',$2,'Fixture browser','127.0.0.1',NOW()+INTERVAL '30 days'),
           ($3,'trust-other','other-secret','Other browser','192.0.2.1',NOW()+INTERVAL '30 days')`,
    [own, fingerprint, other]
  );
}, 40000);
afterEach(async () => {
  await http?.close();
}, 15000);

it('lists only own unexpired records, binds current-device marking to the cookie and exposes no proof', async () => {
  await http.pool.query(`INSERT INTO device_trusts(id,user_id,device_fingerprint,expires_at)
    VALUES ('legacy','trust-owner','legacy-secret',NOW()+INTERVAL '1 day'),('expired','trust-owner','expired-secret',NOW()-INTERVAL '1 second')`);
  const response = await fetch(`${http.base}/api/auth/trusted-devices`, { headers: headers() });
  expect(response.status).toBe(200);
  expect(response.headers.getSetCookie()).toEqual([]);
  const body = await response.text();
  for (const secret of [token, fingerprint, 'other-secret', 'legacy-secret', other, 'expired'])
    expect(body).not.toContain(secret);
  const rows = JSON.parse(body);
  expect(rows).toHaveLength(2);
  expect(rows.find((row: { id: string }) => row.id === own)).toMatchObject({
    userAgent: 'Fixture browser',
    ip: '127.0.0.1',
    isCurrentDevice: true,
  });
  expect(rows.find((row: { id: string }) => row.id === 'legacy')).toMatchObject({
    ip: null,
    userAgent: null,
    isCurrentDevice: false,
  });
  const noProof = await fetch(`${http.base}/api/auth/trusted-devices`, {
    headers: { Cookie: `barghsa_session=${session}; barghsa_device=invalid` },
  });
  expect(noProof.status).toBe(200);
  expect(noProof.headers.getSetCookie()).toEqual([]);
  expect(
    ((await noProof.json()) as Array<{ isCurrentDevice: boolean }>).every(
      (row) => !row.isCurrentDevice
    )
  ).toBe(true);
});

it('requires authentication, CSRF and fresh step-up, with no cross-user or nonexistent deletion', async () => {
  expect((await fetch(`${http.base}/api/auth/trusted-devices`)).status).toBe(401);
  expect([401, 403]).toContain((await fetch(endpoint(), { method: 'DELETE' })).status);
  expect(
    (await fetch(endpoint(), { method: 'DELETE', headers: { Cookie: headers().Cookie } })).status
  ).toBe(403);
  await http.pool.query('UPDATE sessions SET step_up_verified_at=NULL WHERE session_id=$1', [
    session,
  ]);
  const unverified = await fetch(endpoint(), { method: 'DELETE', headers: headers() });
  expect(unverified.status).toBe(403);
  expect(await unverified.text()).toContain('AUTHZ:STEP_UP_REQUIRED');
  const stepUp = (secret: string) =>
    fetch(`${http.base}/api/auth/step-up`, {
      method: 'POST',
      headers: { ...headers(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: secret }),
    });
  expect((await stepUp('wrong-password')).status).toBe(422);
  const verified = await stepUp(password);
  expect(verified.status).toBe(200);
  const values = Object.fromEntries(
    verified.headers.getSetCookie().map((cookie) => cookie.split(';')[0]!.split('='))
  );
  session = values.barghsa_session!;
  csrf = values.barghsa_csrf!;
  for (const id of [other, randomUUID()])
    expect((await fetch(endpoint(id), { method: 'DELETE', headers: headers() })).status).toBe(404);
  expect(
    (await http.pool.query('SELECT count(*)::int AS count FROM device_trusts')).rows[0].count
  ).toBe(2);
  expect(
    (
      await http.pool.query(
        "SELECT count(*)::int AS count FROM audit_log WHERE event='device_trust_revoked'"
      )
    ).rows[0].count
  ).toBe(0);
});

it('revokes durably, audits once without secrets and requires OTP on the next login while retaining sessions', async () => {
  const results = await Promise.all(
    [0, 1].map(() =>
      fetch(endpoint(), {
        method: 'DELETE',
        headers: { ...headers(), 'X-Correlation-Id': 'trust-revoke-http' },
      })
    )
  );
  expect(results.map((response) => response.status).sort()).toEqual([200, 404]);
  const response = results.find((item) => item.status === 200)!;
  expect(await response.json()).toEqual({ revoked: true });
  expect((await http.pool.query('SELECT id FROM device_trusts ORDER BY id')).rows).toEqual([
    { id: other },
  ]);
  expect(
    (await http.pool.query('SELECT revoked_at FROM sessions WHERE session_id=$1', [session]))
      .rows[0].revoked_at
  ).toBeNull();
  const audit = (
    await http.pool.query(
      "SELECT user_id,metadata::jsonb AS metadata,correlation_id FROM audit_log WHERE event='device_trust_revoked'"
    )
  ).rows;
  expect(audit).toHaveLength(1);
  expect(audit[0]).toMatchObject({ user_id: 'trust-owner', metadata: { deviceId: own } });
  expect(audit[0].correlation_id).toBeTruthy();
  expect(JSON.stringify(audit)).not.toContain(fingerprint);
  expect(JSON.stringify(audit)).not.toContain(token);
  await http.pool.query(
    `INSERT INTO email_provider_configs(transport,label,status,config,created_by,last_test_status)
    VALUES ('resend','Fixture mailbox','active',$1,'trust-owner','passed')`,
    [JSON.stringify({ api_key: 'fixture-only-key', from_email: 'auth@example.test' })]
  );
  const login = await fetch(`${http.base}/api/auth/login`, {
    method: 'POST',
    headers: { Cookie: `barghsa_device=${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'trust@example.test', password }),
  });
  expect(login.status, await login.clone().text()).toBe(200);
  expect(await login.json()).toMatchObject({ requiresOtp: true });
});

it.each(['revoke', 'disable', 'step-up', 'expiry'])(
  'rechecks actor %s after an account lock wait',
  async (change) => {
    const lock = await http.pool.connect();
    let removing: Promise<Response> | undefined;
    try {
      await lock.query('BEGIN');
      await lock.query("SELECT user_id FROM users WHERE user_id='trust-owner' FOR UPDATE");
      const pid = (await lock.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;
      removing = fetch(endpoint(), { method: 'DELETE', headers: headers() });
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
      if (change === 'disable')
        await lock.query(
          "UPDATE users SET disabled_at=clock_timestamp() WHERE user_id='trust-owner'"
        );
      else
        await lock.query(
          `UPDATE sessions SET ${change === 'revoke' ? 'revoked_at=clock_timestamp()' : change === 'expiry' ? 'expires_at=clock_timestamp()' : "step_up_verified_at=clock_timestamp()-INTERVAL '16 minutes'"} WHERE session_id=$1`,
          [session]
        );
      await lock.query('COMMIT');
      const result = await removing;
      expect(result.status, await result.clone().text()).toBe(change === 'step-up' ? 403 : 401);
      expect(
        (await http.pool.query('SELECT id FROM device_trusts WHERE id=$1', [own])).rows
      ).toHaveLength(1);
      expect(
        (await http.pool.query("SELECT id FROM audit_log WHERE event='device_trust_revoked'")).rows
      ).toHaveLength(0);
    } finally {
      await lock.query('ROLLBACK');
      lock.release();
      await removing;
    }
  }
);

it('rolls back deletion if its audit cannot persist', async () => {
  await http.pool
    .query(`CREATE FUNCTION deny_trust_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.event='device_trust_revoked' THEN RAISE EXCEPTION 'controlled audit failure'; END IF; RETURN NEW; END; $$;
    CREATE TRIGGER deny_trust_audit BEFORE INSERT ON audit_log FOR EACH ROW EXECUTE FUNCTION deny_trust_audit();`);
  const response = await fetch(endpoint(), { method: 'DELETE', headers: headers() });
  expect(response.status).toBe(500);
  expect(await response.text()).not.toContain('controlled audit failure');
  expect(
    (await http.pool.query('SELECT id FROM device_trusts WHERE id=$1', [own])).rows
  ).toHaveLength(1);
});

it('rechecks step-up expiry after waiting on the target device row', async () => {
  const lock = await http.pool.connect();
  let removing: Promise<Response> | undefined;
  try {
    await http.pool.query(
      "UPDATE sessions SET step_up_verified_at=clock_timestamp()-INTERVAL '14 minutes 58 seconds' WHERE session_id=$1",
      [session]
    );
    await lock.query('BEGIN');
    await lock.query('SELECT id FROM device_trusts WHERE id=$1 FOR UPDATE', [own]);
    removing = fetch(endpoint(), { method: 'DELETE', headers: headers() });
    await expect
      .poll(
        async () =>
          (
            await http.pool.query(`SELECT count(*)::int AS count FROM pg_stat_activity
      WHERE datname=current_database() AND wait_event_type='Lock' AND query LIKE 'SELECT id FROM device_trusts%'`)
          ).rows[0].count
      )
      .toBe(1);
    await expect
      .poll(
        async () =>
          (
            await http.pool.query(
              "SELECT step_up_verified_at<clock_timestamp()-INTERVAL '15 minutes' AS expired FROM sessions WHERE session_id=$1",
              [session]
            )
          ).rows[0].expired,
        { timeout: 5000 }
      )
      .toBe(true);
    await lock.query('COMMIT');
    const response = await removing;
    expect(response.status, await response.clone().text()).toBe(403);
    expect(
      (await http.pool.query('SELECT id FROM device_trusts WHERE id=$1', [own])).rows
    ).toHaveLength(1);
    expect(
      (await http.pool.query("SELECT id FROM audit_log WHERE event='device_trust_revoked'")).rows
    ).toHaveLength(0);
  } finally {
    await lock.query('ROLLBACK');
    lock.release();
    await removing;
  }
});

it('reports database list failures instead of an empty trusted-device list', async () => {
  await http.pool.query('ALTER TABLE device_trusts RENAME TO hidden_trust_fixture');
  const response = await fetch(`${http.base}/api/auth/trusted-devices`, { headers: headers() });
  expect(response.status).toBe(500);
  expect(await response.text()).not.toContain('hidden_trust_fixture');
});
