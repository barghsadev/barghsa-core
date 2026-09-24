import { afterEach, beforeEach, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { startHttpFixture } from '../test/http-fixture.js';

let http: Awaited<ReturnType<typeof startHttpFixture>>;
let headers: Record<string, string>;
beforeEach(async () => {
  http = await startHttpFixture(process.env.TEST_DATABASE_URL!);
  await http.pool.query(
    "INSERT INTO users(user_id,username,password_hash) VALUES ('analytics-owner','analytics@example.test','test-only')"
  );
  const session = randomUUID(),
    csrf = randomUUID();
  await http.pool.query(
    "INSERT INTO sessions(session_id,user_id,csrf_token,expires_at,idle_deadline) VALUES ($1,'analytics-owner',$2,NOW()+INTERVAL '1 day',NOW()+INTERVAL '30 minutes')",
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

const read = () => fetch(`${http.base}/api/user/analytics/consent`, { headers });
const consent = (body: unknown) =>
  fetch(`${http.base}/api/user/analytics/consent`, {
    method: 'PUT',
    headers,
    body: JSON.stringify(body),
  });
const event = (body: unknown) =>
  fetch(`${http.base}/api/user/analytics/events`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });

it('requires opt-in, stores only closed dimensions, and stops recording after revocation', async () => {
  expect(await (await read()).json()).toEqual({ consent: null });
  expect((await event({ name: 'page_view', area: 'customer' })).status).toBe(403);
  expect(
    (
      await fetch(`${http.base}/api/user/analytics/events`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'page_view', area: 'customer' }),
      })
    ).status
  ).toBe(401);
  for (const value of [null, {}, { consent: 'yes' }, { consent: true, userId: 'other' }])
    expect((await consent(value)).status).toBe(400);
  expect((await consent({ consent: true })).status).toBe(200);
  expect(await (await read()).json()).toEqual({ consent: true });
  expect(
    (
      await event({
        name: 'page_view',
        area: 'customer',
        password: 'never-store',
        email: 'private@example.test',
      })
    ).status
  ).toBe(204);
  expect(
    (await event({ name: 'catalogue_view', service: 'electricity', rawText: 'private' })).status
  ).toBe(204);
  expect((await event({ name: 'page_view', area: '/invoices/private' })).status).toBe(400);
  const rows = (
    await http.pool.query(
      'SELECT event_name,area,service FROM analytics_events ORDER BY created_at,id'
    )
  ).rows;
  expect(rows).toEqual([
    { event_name: 'page_view', area: 'customer', service: null },
    { event_name: 'catalogue_view', area: null, service: 'electricity' },
  ]);
  expect((await consent({ consent: false })).status).toBe(200);
  expect((await event({ name: 'page_view', area: 'admin' })).status).toBe(403);
  expect(
    (await http.pool.query('SELECT count(*)::int AS count FROM analytics_events')).rows[0].count
  ).toBe(2);
  expect(
    (
      await http.pool.query(
        "SELECT metadata::jsonb AS metadata FROM audit_log WHERE event='analytics_consent_changed' ORDER BY created_at"
      )
    ).rows
  ).toEqual([
    { metadata: { before: null, after: true } },
    { metadata: { before: true, after: false } },
  ]);
});

it('rolls consent back when the audit insert fails', async () => {
  await http.pool.query(
    "CREATE FUNCTION reject_analytics_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.event='analytics_consent_changed' THEN RAISE EXCEPTION 'controlled analytics audit failure'; END IF; RETURN NEW; END $$; CREATE TRIGGER reject_analytics_audit BEFORE INSERT ON audit_log FOR EACH ROW EXECUTE FUNCTION reject_analytics_audit()"
  );
  expect((await consent({ consent: true })).status).toBe(500);
  expect(await (await read()).json()).toEqual({ consent: null });
});
