import { afterEach, beforeEach, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { startHttpFixture } from '../test/http-fixture.js';

let http: Awaited<ReturnType<typeof startHttpFixture>>;
let headers: Record<string, string>;
beforeEach(async () => {
  http = await startHttpFixture(process.env.TEST_DATABASE_URL!);
  await http.pool.query(
    "INSERT INTO users(user_id,username,password_hash) VALUES ('theme-owner','theme@example.test','test-only'),('theme-other','other-theme@example.test','test-only')"
  );
  const session = randomUUID(),
    csrf = randomUUID();
  await http.pool.query(
    "INSERT INTO sessions(session_id,user_id,csrf_token,expires_at,idle_deadline) VALUES ($1,'theme-owner',$2,NOW()+INTERVAL '1 day',NOW()+INTERVAL '30 minutes')",
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
  fetch(`${http.base}/api/user/settings/theme`, {
    method: 'PUT',
    headers,
    body: JSON.stringify(body),
  });
const read = () => fetch(`${http.base}/api/user/settings/theme`, { headers });

it('defaults to admin mode, validates choices, saves account-specific overrides, and audits changes', async () => {
  expect(await (await read()).json()).toEqual({ mode: null });
  for (const body of [
    null,
    {},
    { mode: 'system' },
    { mode: 1 },
    { mode: 'dark', userId: 'theme-other' },
  ])
    expect((await save(body)).status).toBe(400);
  for (const mode of ['dark', 'light', null] as const) {
    const response = await save({ mode });
    expect(response.status, await response.clone().text()).toBe(200);
    expect(await response.json()).toEqual({ mode });
    expect(await (await read()).json()).toEqual({ mode });
  }
  expect(
    (await http.pool.query("SELECT theme_mode FROM users WHERE user_id='theme-other'")).rows[0]
      .theme_mode
  ).toBeNull();
  expect(
    (
      await http.pool.query(
        "SELECT metadata::jsonb AS metadata,correlation_id FROM audit_log WHERE event='theme_mode_changed' ORDER BY created_at"
      )
    ).rows
  ).toEqual([
    { metadata: { before: null, after: 'dark' }, correlation_id: headers['X-Correlation-ID'] },
    { metadata: { before: 'dark', after: 'light' }, correlation_id: headers['X-Correlation-ID'] },
    { metadata: { before: 'light', after: null }, correlation_id: headers['X-Correlation-ID'] },
  ]);
});

it('rolls back the preference when its audit insert fails', async () => {
  await http.pool.query(
    "CREATE FUNCTION reject_theme_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.event='theme_mode_changed' THEN RAISE EXCEPTION 'controlled theme audit failure'; END IF; RETURN NEW; END $$; CREATE TRIGGER reject_theme_audit BEFORE INSERT ON audit_log FOR EACH ROW EXECUTE FUNCTION reject_theme_audit()"
  );
  expect((await save({ mode: 'dark' })).status).toBe(500);
  expect(await (await read()).json()).toEqual({ mode: null });
});
