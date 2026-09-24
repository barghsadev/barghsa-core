import { afterAll, beforeAll, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { startHttpFixture } from '../test/http-fixture.js';

let http: Awaited<ReturnType<typeof startHttpFixture>>;

beforeAll(async () => {
  if (!process.env.TEST_DATABASE_URL) throw new Error('Missing PostgreSQL');
  http = await startHttpFixture(process.env.TEST_DATABASE_URL);
}, 40_000);

afterAll(async () => {
  await http?.close();
});

async function setMaintenance(capability: string, active: boolean) {
  await http.pool.query(
    `INSERT INTO app_config(key,value,version,updated_at)
     VALUES($1,$2::jsonb,1,NOW())
     ON CONFLICT(key) DO UPDATE SET value=EXCLUDED.value,version=app_config.version+1,updated_at=NOW()`,
    [
      `maintenance.${capability}`,
      JSON.stringify({
        active,
        reason: active ? { fa: 'بازگشت به زودی', en: 'Back soon' } : null,
        estimatedUntil: active ? '2099-01-01T00:00:00.000Z' : null,
        owner: active ? 'Operations' : null,
      }),
    ]
  );
}

it('pauses only the selected new action while other capabilities and health remain available', async () => {
  await setMaintenance('electricity_checkout', true);
  const status = await fetch(`${http.base}/api/maintenance`);
  expect(status.status, http.logs()).toBe(200);
  expect(status.headers.get('cache-control')).toContain('no-store');
  const body = (await status.json()) as {
    capabilities: Array<{ capability: string; active: boolean; reason: { en: string } | null }>;
  };
  expect(
    body.capabilities.find((item) => item.capability === 'electricity_checkout')
  ).toMatchObject({
    active: true,
    reason: { en: 'Back soon' },
  });

  const blocked = await fetch(`${http.base}/api/electricity/orders/simple`, { method: 'POST' });
  expect(blocked.status, http.logs()).toBe(503);
  expect(await blocked.json()).toMatchObject({
    error: {
      code: 'MAINTENANCE:ACTIVE',
      capability: 'electricity_checkout',
      supportUrl: '/tickets',
      reason: 'Back soon',
    },
  });

  const saving = await fetch(`${http.base}/api/saving/orders`, { method: 'POST' });
  expect(saving.status).not.toBe(503);
  const health = await fetch(`${http.base}/api/health/live`);
  expect(health.status).toBe(200);
  expect(await health.json()).toEqual({ status: 'ok' });

  await setMaintenance('electricity_checkout', false);
  const resumed = await fetch(`${http.base}/api/electricity/orders/simple`, { method: 'POST' });
  expect(resumed.status).not.toBe(503);
});

it('does not pause existing reads or unrelated new actions during wallet top-up maintenance', async () => {
  await setMaintenance('wallet_topup', true);
  const profile = '11111111-1111-4111-8111-111111111111';
  const blocked = await fetch(`${http.base}/api/wallet/${profile}/top-ups`, { method: 'POST' });
  expect(blocked.status, http.logs()).toBe(503);
  expect(await blocked.json()).toMatchObject({ error: { capability: 'wallet_topup' } });
  expect((await fetch(`${http.base}/api/wallet/${profile}`)).status).not.toBe(503);
  expect((await fetch(`${http.base}/api/solar/requests`, { method: 'POST' })).status).not.toBe(503);
});

it('requires staff authority and step-up, versions changes, and records the audit trail', async () => {
  const operator = 'maintenance-operator';
  const session = randomUUID();
  const csrf = randomUUID();
  await http.pool.query(
    `INSERT INTO staff_roles(role_id,name,description,permissions)
     VALUES('test-maintenance','Maintenance','Test role','["admin:config:read","admin:config:write"]')`
  );
  await http.pool.query(
    "INSERT INTO users(user_id,username,password_hash,is_staff) VALUES ($1,$2,'test-only',true)",
    [operator, `${operator}@example.test`]
  );
  await http.pool.query("INSERT INTO user_roles(user_id,role_id) VALUES($1,'test-maintenance')", [
    operator,
  ]);
  await http.pool.query(
    `INSERT INTO sessions(session_id,user_id,csrf_token,family_id,expires_at,idle_deadline,step_up_verified_at)
     VALUES($1,$2,$3,$4,NOW()+INTERVAL '1 day',NOW()+INTERVAL '30 minutes',NOW())`,
    [session, operator, csrf, randomUUID()]
  );
  const path = `${http.base}/api/admin/maintenance/saving_orders`;
  const headers = {
    Cookie: `barghsa_session=${session}`,
    'X-CSRF-Token': csrf,
    'Content-Type': 'application/json',
  };
  const body = {
    active: true,
    reason: { fa: 'در حال بررسی', en: 'Being checked' },
    estimatedUntil: '2099-01-01T00:00:00.000Z',
    owner: 'Operations',
    expectedVersion: 0,
  };
  const put = (value: unknown) =>
    fetch(path, { method: 'PUT', headers, body: JSON.stringify(value) });

  expect((await fetch(path, { method: 'PUT', body: JSON.stringify(body) })).status).toBe(401);
  expect((await put({ ...body, reason: null })).status).toBe(400);
  await http.pool.query('UPDATE sessions SET step_up_verified_at=NULL WHERE session_id=$1', [
    session,
  ]);
  expect((await put(body)).status).toBe(403);
  await http.pool.query('UPDATE sessions SET step_up_verified_at=NOW() WHERE session_id=$1', [
    session,
  ]);
  const activated = await put(body);
  expect(activated.status, http.logs()).toBe(200);
  expect(await activated.json()).toMatchObject({
    capability: 'saving_orders',
    active: true,
    version: 1,
  });
  expect((await put(body)).status).toBe(409);
  const audit = (
    await http.pool.query(
      "SELECT metadata::jsonb AS metadata FROM audit_log WHERE event='config_change' AND metadata::jsonb->>'key'='maintenance.saving_orders'"
    )
  ).rows;
  expect(audit).toHaveLength(1);
  expect(audit[0].metadata).toMatchObject({
    previous: { active: false, version: 0 },
    next: { active: true, version: 1 },
  });
});
