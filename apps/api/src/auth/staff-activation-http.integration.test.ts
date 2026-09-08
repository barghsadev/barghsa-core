import { afterEach, beforeEach, expect, it } from 'vitest';
import { createHash, randomUUID } from 'node:crypto';
import * as argon2 from 'argon2';
import { startHttpFixture } from '../test/http-fixture.js';

let http: Awaited<ReturnType<typeof startHttpFixture>>;
const token = 'b'.repeat(64);
const tokenHash = createHash('sha256').update(token).digest('hex');
const newPassword = 'Activated-staff-password-123!';
const activate = () =>
  fetch(`${http.base}/api/auth/activate-staff`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token, newPassword }),
  });

beforeEach(async () => {
  if (!process.env.TEST_DATABASE_URL) throw new Error('PostgreSQL setup did not run');
  http = await startHttpFixture(process.env.TEST_DATABASE_URL);
  await http.pool.query(
    `INSERT INTO users(user_id,username,password_hash,is_staff,must_change_password,activation_token,activation_token_expires_at)
    VALUES ('activating','activating@example.test','previous-password-hash',true,true,$1,clock_timestamp()+INTERVAL '1 day'),
    ('unrelated','unrelated@example.test','fixture-only',false,false,NULL,NULL)`,
    [tokenHash]
  );
  for (const userId of ['activating', 'unrelated']) {
    const session = randomUUID(),
      family = randomUUID();
    await http.pool.query(
      `INSERT INTO sessions(session_id,user_id,csrf_token,family_id,expires_at,idle_deadline)
      VALUES ($1,$2,$3,$4,NOW()+INTERVAL '1 day',NOW()+INTERVAL '30 minutes')`,
      [session, userId, randomUUID(), family]
    );
    await http.pool.query(
      `INSERT INTO refresh_tokens(id,family_id,token_hash,user_id,session_id)
      VALUES ($1,$2,$3,$4,$5)`,
      [randomUUID(), family, randomUUID(), userId, session]
    );
  }
}, 40000);
afterEach(async () => {
  await http?.close();
}, 15000);

async function unchanged(expectedToken: string | null = tokenHash) {
  expect(
    (
      await http.pool.query(`SELECT password_hash,must_change_password,activation_token
    FROM users WHERE user_id='activating'`)
    ).rows[0]
  ).toEqual({
    password_hash: 'previous-password-hash',
    must_change_password: true,
    activation_token: expectedToken,
  });
  expect((await http.pool.query('SELECT revoked_at FROM sessions')).rows).toEqual([
    { revoked_at: null },
    { revoked_at: null },
  ]);
  expect((await http.pool.query('SELECT consumed_at FROM refresh_tokens')).rows).toEqual([
    { consumed_at: null },
    { consumed_at: null },
  ]);
  expect(
    (await http.pool.query("SELECT id FROM audit_log WHERE event='staff_user_activated'")).rows
  ).toHaveLength(0);
}

it('rejects staff activation when the token expires during the account lock wait', async () => {
  await http.pool.query(
    "UPDATE users SET activation_token_expires_at=clock_timestamp()+INTERVAL '2 seconds' WHERE user_id='activating'"
  );
  const lock = await http.pool.connect();
  let pending: Promise<Response> | undefined;
  try {
    await lock.query('BEGIN');
    await lock.query("SELECT user_id FROM users WHERE user_id='activating' FOR UPDATE");
    const pid = (await lock.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;
    pending = activate();
    await expect
      .poll(
        async () =>
          (
            await http.pool.query(
              `SELECT count(*)::int AS count
      FROM pg_stat_activity WHERE datname=current_database() AND $1=ANY(pg_blocking_pids(pid))`,
              [pid]
            )
          ).rows[0].count
      )
      .toBe(1);
    await expect
      .poll(
        async () =>
          (
            await http.pool.query(`SELECT activation_token_expires_at<=clock_timestamp() AS expired
      FROM users WHERE user_id='activating'`)
          ).rows[0].expired,
        { timeout: 5000 }
      )
      .toBe(true);
    await lock.query('COMMIT');
    const response = await pending;
    expect(response.status, await response.clone().text()).toBe(401);
    await unchanged();
  } finally {
    await lock.query('ROLLBACK');
    lock.release();
    await pending;
  }
});

it('rolls back staff activation when the token expires during audit persistence', async () => {
  await http.pool.query(`CREATE SEQUENCE activation_audit_calls;
    CREATE FUNCTION delay_activation_audit() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN IF NEW.event='staff_user_activated' THEN
      PERFORM nextval('activation_audit_calls'); PERFORM pg_sleep(2.2);
    END IF; RETURN NEW; END $$;
    CREATE TRIGGER delay_activation_audit BEFORE INSERT ON audit_log
    FOR EACH ROW EXECUTE FUNCTION delay_activation_audit()`);
  await http.pool.query(
    "UPDATE users SET activation_token_expires_at=clock_timestamp()+INTERVAL '2 seconds' WHERE user_id='activating'"
  );
  const response = await activate();
  expect(
    (await http.pool.query('SELECT is_called FROM activation_audit_calls')).rows[0].is_called
  ).toBe(true);
  expect(response.status, await response.clone().text()).toBe(401);
  await unchanged();
});

it('activates once and invalidates only that account credentials in the same audited transaction', async () => {
  const responses = await Promise.all([activate(), activate()]);
  expect(responses.map((r) => r.status).sort()).toEqual([200, 401]);
  const success = responses.find((r) => r.status === 200)!;
  expect(await success.json()).toEqual({ activated: true });
  expect(success.headers.getSetCookie()).toEqual([]);
  const user = (
    await http.pool.query(
      "SELECT password_hash,must_change_password,activation_token,activation_token_expires_at FROM users WHERE user_id='activating'"
    )
  ).rows[0];
  expect(user).toMatchObject({
    must_change_password: false,
    activation_token: null,
    activation_token_expires_at: null,
  });
  expect(await argon2.verify(user.password_hash, newPassword)).toBe(true);
  expect(
    (
      await http.pool.query(
        'SELECT user_id,revoked_at IS NOT NULL AS revoked FROM sessions ORDER BY user_id'
      )
    ).rows
  ).toEqual([
    { user_id: 'activating', revoked: true },
    { user_id: 'unrelated', revoked: false },
  ]);
  expect(
    (
      await http.pool.query(
        'SELECT user_id,consumed_at IS NOT NULL AS consumed FROM refresh_tokens ORDER BY user_id'
      )
    ).rows
  ).toEqual([
    { user_id: 'activating', consumed: true },
    { user_id: 'unrelated', consumed: false },
  ]);
  const audits = (
    await http.pool.query(
      "SELECT user_id,metadata FROM audit_log WHERE event='staff_user_activated'"
    )
  ).rows;
  expect(audits).toHaveLength(1);
  expect(audits[0].user_id).toBe('activating');
  for (const secret of [token, tokenHash, newPassword, user.password_hash])
    expect(JSON.stringify(audits)).not.toContain(secret);
});

it.each(['expired', 'disabled', 'customer'])(
  'rejects %s staff activation without credential changes',
  async (state) => {
    const set =
      state === 'expired'
        ? "activation_token_expires_at=clock_timestamp()-INTERVAL '1 second'"
        : state === 'disabled'
          ? 'disabled_at=clock_timestamp()'
          : 'is_staff=false';
    await http.pool.query(`UPDATE users SET ${set} WHERE user_id='activating'`);
    expect((await activate()).status).toBe(401);
    // The existing account-version trigger clears activation links on disablement.
    await unchanged(state === 'disabled' ? null : tokenHash);
  }
);

it('rolls back staff activation if its audit cannot persist', async () => {
  await http.pool
    .query(`CREATE FUNCTION reject_activation_audit() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN IF NEW.event='staff_user_activated' THEN RAISE EXCEPTION 'controlled activation audit failure'; END IF; RETURN NEW; END $$;
    CREATE TRIGGER reject_activation_audit BEFORE INSERT ON audit_log FOR EACH ROW EXECUTE FUNCTION reject_activation_audit()`);
  const response = await activate();
  expect(response.status).toBe(500);
  expect(await response.text()).not.toContain('controlled activation audit failure');
  await unchanged();
});
