import { afterEach, beforeEach, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { startHttpFixture } from '../test/http-fixture.js';

let http: Awaited<ReturnType<typeof startHttpFixture>>;
let headers: Record<string, string>;
let sessionId: string;
beforeEach(async () => {
  http = await startHttpFixture(process.env.TEST_DATABASE_URL!);
  await http.pool.query(
    "INSERT INTO users(user_id,username,password_hash,mobile) VALUES ('owner','primary@example.test','test-only','+989120005555'),('other','other@example.test','test-only',NULL)"
  );
  sessionId = randomUUID();
  const csrf = randomUUID();
  await http.pool.query(
    "INSERT INTO sessions(session_id,user_id,csrf_token,expires_at,idle_deadline) VALUES ($1,'owner',$2,NOW()+INTERVAL '1 day',NOW()+INTERVAL '30 minutes')",
    [sessionId, csrf]
  );
  headers = {
    Cookie: `barghsa_session=${sessionId}`,
    'X-CSRF-Token': csrf,
    'Content-Type': 'application/json',
    'X-Correlation-ID': randomUUID(),
  };
}, 40000);
afterEach(async () => {
  await http?.close();
}, 15000);
const read = () => fetch(`${http.base}/api/user/settings/notifications`, { headers });
const save = (body: unknown, actor = headers) =>
  fetch(`${http.base}/api/user/settings/notifications`, {
    method: 'PUT',
    headers: actor,
    body: JSON.stringify(body),
  });
const stored = async () =>
  (await http.pool.query("SELECT notification_preferences FROM users WHERE user_id='owner'"))
    .rows[0].notification_preferences;
const audits = async () =>
  (
    await http.pool.query(
      "SELECT metadata::jsonb AS metadata,correlation_id FROM audit_log WHERE event='notification_preferences_changed'"
    )
  ).rows;

it('uses a legacy primary contact and excludes an unverified secondary channel', async () => {
  expect(await (await read()).json()).toEqual({
    channels: ['IN_APP'],
    availableChannels: ['IN_APP', 'EMAIL'],
  });
  const response = await save({ channels: ['EMAIL'] });
  expect(response.status, await response.clone().text()).toBe(200);
  expect(await response.json()).toEqual({
    channels: ['IN_APP', 'EMAIL'],
    availableChannels: ['IN_APP', 'EMAIL'],
  });
  expect((await save({ channels: ['SMS'] })).status).toBe(400);
  expect(await stored()).toBe('IN_APP,EMAIL');
  expect(
    (await http.pool.query("SELECT notification_preferences FROM users WHERE user_id='other'"))
      .rows[0].notification_preferences
  ).toBe('IN_APP');
});

it('persists verified available channels and an explicit opt-out with correlated audits', async () => {
  await http.pool.query(
    "INSERT INTO account_login_identifiers(destination,user_id,kind,verified_at) VALUES ('+989120005555','owner','mobile',NOW())"
  );
  const response = await save({ channels: ['SMS', 'EMAIL'] });
  expect(response.status, await response.clone().text()).toBe(200);
  expect(await response.json()).toEqual({
    channels: ['IN_APP', 'EMAIL', 'SMS'],
    availableChannels: ['IN_APP', 'EMAIL', 'SMS'],
  });
  expect(await audits()).toEqual([
    {
      metadata: { before: ['IN_APP'], after: ['IN_APP', 'EMAIL', 'SMS'] },
      correlation_id: headers['X-Correlation-ID'],
    },
  ]);
  expect((await save({ channels: ['IN_APP'] })).status).toBe(200);
  expect(await (await read()).json()).toMatchObject({ channels: ['IN_APP'] });
  expect(await stored()).toBe('IN_APP');
  expect(await audits()).toHaveLength(2);
});

it('rejects malformed requests and missing authentication or CSRF without writes', async () => {
  for (const body of [
    null,
    {},
    { channels: [] },
    { channels: ['PUSH'] },
    { channels: 'EMAIL' },
    { channels: ['EMAIL'], userId: 'other' },
  ])
    expect((await save(body)).status).toBe(400);
  expect((await save({ channels: ['EMAIL'] }, { 'Content-Type': 'application/json' })).status).toBe(
    401
  );
  expect((await save({ channels: ['EMAIL'] }, { ...headers, 'X-CSRF-Token': '' })).status).toBe(
    403
  );
  expect(await stored()).toBe('IN_APP');
  expect(await audits()).toEqual([]);
});

it('rolls preference writes back if their audit fails', async () => {
  await http.pool.query(
    "CREATE FUNCTION fail_notification_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.event='notification_preferences_changed' THEN RAISE EXCEPTION 'controlled audit failure'; END IF; RETURN NEW; END $$; CREATE TRIGGER fail_notification_audit BEFORE INSERT ON audit_log FOR EACH ROW EXECUTE FUNCTION fail_notification_audit()"
  );
  expect((await save({ channels: ['EMAIL'] })).status).toBe(500);
  expect(await stored()).toBe('IN_APP');
  expect(await audits()).toEqual([]);
});

it.each(['disabled', 'revoked', 'csrf'] as const)(
  'rechecks %s actor authority after an account lock wait',
  async (change) => {
    const blocker = await http.pool.connect();
    let pending: Promise<Response> | undefined;
    try {
      await blocker.query('BEGIN');
      await blocker.query("SELECT user_id FROM users WHERE user_id='owner' FOR UPDATE");
      const pid = (await blocker.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;
      pending = save({ channels: ['EMAIL'] });
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
      if (change === 'disabled')
        await blocker.query("UPDATE users SET disabled_at=NOW() WHERE user_id='owner'");
      else
        await blocker.query(
          change === 'revoked'
            ? 'UPDATE sessions SET revoked_at=NOW() WHERE session_id=$1'
            : "UPDATE sessions SET csrf_token='changed' WHERE session_id=$1",
          [sessionId]
        );
      await blocker.query('COMMIT');
      expect((await pending).status).toBe(change === 'csrf' ? 403 : 401);
      expect(await stored()).toBe('IN_APP');
      expect(await audits()).toEqual([]);
    } finally {
      await blocker.query('ROLLBACK');
      blocker.release();
      await pending;
    }
  }
);

it('rolls back when the session expires during audit persistence', async () => {
  await http.pool.query(
    "CREATE SEQUENCE notification_audit_reached; CREATE FUNCTION delay_notification_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.event='notification_preferences_changed' THEN PERFORM nextval('notification_audit_reached'); PERFORM pg_sleep(2.2); END IF; RETURN NEW; END $$; CREATE TRIGGER delay_notification_audit BEFORE INSERT ON audit_log FOR EACH ROW EXECUTE FUNCTION delay_notification_audit()"
  );
  await http.pool.query(
    "UPDATE sessions SET expires_at=clock_timestamp()+INTERVAL '2 seconds' WHERE session_id=$1",
    [sessionId]
  );
  expect((await save({ channels: ['EMAIL'] })).status).toBe(401);
  expect(
    (await http.pool.query('SELECT is_called FROM notification_audit_reached')).rows[0].is_called
  ).toBe(true);
  expect(await stored()).toBe('IN_APP');
  expect(await audits()).toEqual([]);
});
