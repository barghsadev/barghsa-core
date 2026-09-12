import { afterEach, beforeEach, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { startHttpFixture } from '../test/http-fixture.js';

let http: Awaited<ReturnType<typeof startHttpFixture>>;
let headers: Record<string, string>;
let sessionId: string;
let selected: string;
let defaultProfile: string;
beforeEach(async () => {
  http = await startHttpFixture(process.env.TEST_DATABASE_URL!);
  await http.pool.query(
    "INSERT INTO users(user_id,username,password_hash) VALUES ('owner','owner@example.test','test-only'),('other','other@example.test','test-only')"
  );
  selected = randomUUID();
  defaultProfile = randomUUID();
  await http.pool.query(
    "INSERT INTO profiles(id,user_id,profile_type,is_default) VALUES ($1,'owner','INDIVIDUAL',true),($2,'owner','LEGAL',false)",
    [defaultProfile, selected]
  );
  await http.pool.query(
    "INSERT INTO user_profile_contexts(user_id,profile_id) VALUES ('owner',$1)",
    [selected]
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
const read = () => fetch(`${http.base}/api/user/settings/marketing-consent`, { headers });
const save = (body: unknown) =>
  fetch(`${http.base}/api/user/settings/marketing-consent`, {
    method: 'PUT',
    headers,
    body: JSON.stringify(body),
  });
const stored = async () =>
  (
    await http.pool.query(
      'SELECT profile_id,channel,marketing_opted_in,consent_granted_at,consent_revoked_at,updated_at FROM user_notification_preferences ORDER BY profile_id,channel'
    )
  ).rows;
const audits = async () =>
  (
    await http.pool.query(
      "SELECT metadata::jsonb AS metadata,correlation_id,ip FROM audit_log WHERE event='marketing_consent_changed' ORDER BY created_at"
    )
  ).rows;

it('reads and updates only the selected owned profile and returns its committed state', async () => {
  await http.pool.query(
    "INSERT INTO user_notification_preferences(profile_id,channel,marketing_opted_in) VALUES ($1,'email',true)",
    [selected]
  );
  expect(await (await read()).json()).toMatchObject({ channels: { email: { optedIn: true } } });
  const response = await save({ email: false, sms: true });
  expect(response.status, await response.clone().text()).toBe(200);
  expect(await response.json()).toMatchObject({
    channels: { email: { optedIn: false }, sms: { optedIn: true } },
  });
  const rows = await stored();
  expect(rows).toHaveLength(2);
  expect(rows.every((row) => row.profile_id === selected)).toBe(true);
  expect(rows.find((row) => row.channel === 'email').consent_revoked_at).toBeInstanceOf(Date);
  expect(rows.find((row) => row.channel === 'sms').consent_granted_at).toBeInstanceOf(Date);
  expect(await audits()).toMatchObject([
    {
      correlation_id: headers['X-Correlation-ID'],
      metadata: {
        profileId: selected,
        before: { email: true, sms: false },
        after: { email: false, sms: true },
      },
    },
  ]);
  expect((await audits())[0].ip).toBeTruthy();
});

it('rejects malformed consent values rather than partially applying a request', async () => {
  for (const body of [
    null,
    {},
    { email: true, sms: 'false' },
    { email: true, profileId: defaultProfile },
    [],
  ]) {
    expect((await save(body)).status, JSON.stringify(body)).toBe(400);
  }
  expect(await stored()).toEqual([]);
  expect(await audits()).toEqual([]);
});

it('does not write to other owned profiles when the selection belongs to someone else', async () => {
  await http.pool.query("UPDATE profiles SET user_id='other' WHERE id=$1", [selected]);
  expect((await save({ email: true })).status).toBe(404);
  expect(await stored()).toEqual([]);
  expect(await audits()).toEqual([]);
});

it('preserves consent timestamps and audit history on a repeated unchanged save', async () => {
  expect((await save({ email: true })).status).toBe(200);
  const before = await stored();
  const history = await audits();
  expect((await save({ email: true })).status).toBe(200);
  expect(await stored()).toEqual(before);
  expect(await audits()).toEqual(history);
});

it('rolls back consent when the session expires during audit persistence', async () => {
  await http.pool.query(
    "CREATE SEQUENCE consent_audit_reached; CREATE FUNCTION delay_consent_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.event='marketing_consent_changed' THEN PERFORM nextval('consent_audit_reached'); PERFORM pg_sleep(2.2); END IF; RETURN NEW; END $$; CREATE TRIGGER delay_consent_audit BEFORE INSERT ON audit_log FOR EACH ROW EXECUTE FUNCTION delay_consent_audit()"
  );
  await http.pool.query(
    "UPDATE sessions SET expires_at=clock_timestamp()+INTERVAL '2 seconds' WHERE session_id=$1",
    [sessionId]
  );
  expect((await save({ email: true })).status).toBe(401);
  expect(
    (await http.pool.query('SELECT is_called FROM consent_audit_reached')).rows[0].is_called
  ).toBe(true);
  expect(await stored()).toEqual([]);
  expect(await audits()).toEqual([]);
});

it.each(['disabled', 'revoked', 'csrf', 'selection'] as const)(
  'honors current %s after the request guard waits for the account lock',
  async (change) => {
    const blocker = await http.pool.connect();
    let pending: Promise<Response> | undefined;
    try {
      await blocker.query('BEGIN');
      await blocker.query("SELECT user_id FROM users WHERE user_id='owner' FOR UPDATE");
      const pid = (await blocker.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;
      pending = save({ email: true });
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
      else if (change === 'selection')
        await blocker.query(
          "UPDATE user_profile_contexts SET profile_id=$1 WHERE user_id='owner'",
          [defaultProfile]
        );
      else
        await blocker.query(
          change === 'revoked'
            ? 'UPDATE sessions SET revoked_at=NOW() WHERE session_id=$1'
            : "UPDATE sessions SET csrf_token='changed' WHERE session_id=$1",
          [sessionId]
        );
      await blocker.query('COMMIT');
      expect((await pending).status).toBe(
        change === 'csrf' ? 403 : change === 'selection' ? 200 : 401
      );
      if (change === 'selection') {
        // The shared CSRF guard locks the account before this handler resolves selection.
        // A switch completed during that guard wait must affect only the new selection.
        expect(await stored()).toMatchObject([
          { profile_id: defaultProfile, channel: 'email', marketing_opted_in: true },
        ]);
        expect(await stored()).toHaveLength(1);
        expect(await audits()).toMatchObject([{ metadata: { profileId: defaultProfile } }]);
      } else {
        expect(await stored()).toEqual([]);
        expect(await audits()).toEqual([]);
      }
    } finally {
      await blocker.query('ROLLBACK');
      blocker.release();
      await pending;
    }
  }
);

it.each(['archive', 'ownership'] as const)(
  'rechecks profile %s after waiting for its row lock',
  async (change) => {
    const blocker = await http.pool.connect();
    let pending: Promise<Response> | undefined;
    try {
      await blocker.query('BEGIN');
      await blocker.query('SELECT id FROM profiles WHERE id=$1 FOR UPDATE', [selected]);
      const pid = (await blocker.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;
      pending = save({ email: true });
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
      await blocker.query(
        change === 'archive'
          ? 'UPDATE profiles SET archived=true WHERE id=$1'
          : "UPDATE profiles SET user_id='other' WHERE id=$1",
        [selected]
      );
      await blocker.query('COMMIT');
      expect((await pending).status).toBe(404);
      expect(await stored()).toEqual([]);
      expect(await audits()).toEqual([]);
    } finally {
      await blocker.query('ROLLBACK');
      blocker.release();
      await pending;
    }
  }
);

it('rolls back consent if its audit write fails', async () => {
  await http.pool.query(
    "CREATE FUNCTION fail_consent_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.event='marketing_consent_changed' THEN RAISE EXCEPTION 'controlled audit failure'; END IF; RETURN NEW; END $$; CREATE TRIGGER fail_consent_audit BEFORE INSERT ON audit_log FOR EACH ROW EXECUTE FUNCTION fail_consent_audit()"
  );
  expect((await save({ email: true })).status).toBe(500);
  expect(await stored()).toEqual([]);
  expect(await audits()).toEqual([]);
});

it('uses the owned default only when no explicit selection exists', async () => {
  await http.pool.query("DELETE FROM user_profile_contexts WHERE user_id='owner'");
  expect((await save({ sms: true })).status).toBe(200);
  expect(await stored()).toMatchObject([
    { profile_id: defaultProfile, channel: 'sms', marketing_opted_in: true },
  ]);
  await http.pool.query(
    "INSERT INTO user_profile_contexts(user_id,profile_id) VALUES ('owner',NULL)"
  );
  expect((await save({ email: true })).status).toBe(404);
  expect(await stored()).toHaveLength(1);
});
