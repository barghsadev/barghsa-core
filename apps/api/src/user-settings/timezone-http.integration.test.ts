import { afterEach, beforeEach, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { startHttpFixture } from '../test/http-fixture.js';

let http: Awaited<ReturnType<typeof startHttpFixture>>;
let headers: Record<string, string>;
beforeEach(async () => {
  http = await startHttpFixture(process.env.TEST_DATABASE_URL!);
  await http.pool.query(
    "INSERT INTO users(user_id,username,password_hash) VALUES ('timezone-owner','timezone@example.test','test-only'),('timezone-other','other-timezone@example.test','test-only')"
  );
  const session = randomUUID(),
    csrf = randomUUID();
  await http.pool.query(
    "INSERT INTO sessions(session_id,user_id,csrf_token,expires_at,idle_deadline) VALUES ($1,'timezone-owner',$2,NOW()+INTERVAL '1 day',NOW()+INTERVAL '30 minutes')",
    [session, csrf]
  );
  headers = {
    Cookie: `barghsa_session=${session}`,
    'X-CSRF-Token': csrf,
    'Content-Type': 'application/json',
    'X-Correlation-ID': randomUUID(),
  };
}, 40000);
afterEach(async () => {
  await http?.close();
}, 15000);
const save = (body: unknown) =>
  fetch(`${http.base}/api/user/settings/timezone`, {
    method: 'PUT',
    headers,
    body: JSON.stringify(body),
  });
const read = () => fetch(`${http.base}/api/user/settings/timezone`, { headers });
const audits = async () =>
  (
    await http.pool.query(
      "SELECT metadata::jsonb AS metadata,correlation_id FROM audit_log WHERE event='timezone_changed' ORDER BY created_at"
    )
  ).rows;

it('defaults to Tehran, rejects malformed input and persists only the current account with an audit', async () => {
  expect(await (await read()).json()).toEqual({ timezone: 'Asia/Tehran' });
  for (const body of [
    null,
    [],
    {},
    { timezone: 1 },
    { timezone: '' },
    { timezone: 'Mars/Olympus' },
    { timezone: 'UTC', userId: 'timezone-other' },
  ])
    expect((await save(body)).status).toBe(400);
  expect(await audits()).toEqual([]);
  const response = await save({ timezone: 'America/Los_Angeles' });
  expect(response.status, await response.clone().text()).toBe(200);
  expect(await response.json()).toEqual({ timezone: 'America/Los_Angeles' });
  expect(await (await read()).json()).toEqual({ timezone: 'America/Los_Angeles' });
  expect(
    (await http.pool.query("SELECT timezone FROM users WHERE user_id='timezone-other'")).rows[0]
      .timezone
  ).toBe('Asia/Tehran');
  expect(await audits()).toEqual([
    {
      metadata: { before: 'Asia/Tehran', after: 'America/Los_Angeles' },
      correlation_id: headers['X-Correlation-ID'],
    },
  ]);
});

it('rolls timezone changes back when audit persistence fails', async () => {
  await http.pool.query(
    "CREATE FUNCTION reject_timezone_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.event='timezone_changed' THEN RAISE EXCEPTION 'controlled timezone audit failure'; END IF; RETURN NEW; END $$; CREATE TRIGGER reject_timezone_audit BEFORE INSERT ON audit_log FOR EACH ROW EXECUTE FUNCTION reject_timezone_audit()"
  );
  expect((await save({ timezone: 'UTC' })).status).toBe(500);
  expect(await (await read()).json()).toEqual({ timezone: 'Asia/Tehran' });
  expect(await audits()).toEqual([]);
});

it('rolls timezone changes back if the session expires during audit persistence', async () => {
  await http.pool.query(
    "CREATE SEQUENCE timezone_audit_reached; CREATE FUNCTION delay_timezone_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.event='timezone_changed' THEN PERFORM nextval('timezone_audit_reached'); PERFORM pg_sleep(2.2); END IF; RETURN NEW; END $$; CREATE TRIGGER delay_timezone_audit BEFORE INSERT ON audit_log FOR EACH ROW EXECUTE FUNCTION delay_timezone_audit()"
  );
  await http.pool.query(
    "UPDATE sessions SET expires_at=clock_timestamp()+INTERVAL '2 seconds' WHERE user_id='timezone-owner'"
  );
  const response = await save({ timezone: 'UTC' });
  expect(
    (await http.pool.query('SELECT is_called FROM timezone_audit_reached')).rows[0].is_called
  ).toBe(true);
  expect(response.status, await response.clone().text()).toBe(401);
  expect(
    (await http.pool.query("SELECT timezone FROM users WHERE user_id='timezone-owner'")).rows[0]
      .timezone
  ).toBe('Asia/Tehran');
  expect(await audits()).toEqual([]);
});
