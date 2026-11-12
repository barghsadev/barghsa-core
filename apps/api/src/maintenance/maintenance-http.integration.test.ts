import { afterAll, beforeAll, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { standardMaintenanceNotice } from '@barghsa/i18n/maintenance-public';
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
  const readiness = await fetch(`${http.base}/api/health/ready`);
  expect(readiness.status, http.logs()).toBe(200);
  expect(await readiness.json()).toMatchObject({
    checks: { postgresql: { status: 'ok' } },
  });

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
  const invalid = await put({ ...body, reason: null });
  expect(invalid.status).toBe(400);
  expect(await invalid.json()).toMatchObject({
    error: { code: 'VALIDATION:INPUT:INVALID', fields: ['reasonFa', 'reasonEn'] },
  });
  const past = await put({ ...body, estimatedUntil: '2020-01-01T00:00:00Z', owner: ' ' });
  expect(past.status).toBe(400);
  const pastBody = await past.json();
  expect(pastBody).toMatchObject({ error: { fields: expect.arrayContaining(['owner']) } });
  expect(JSON.stringify(pastBody)).not.toContain('2020-01-01');
  const deadline = await put({ ...body, estimatedUntil: '2020-01-01T00:00:00Z' });
  expect(deadline.status).toBe(400);
  expect(await deadline.json()).toMatchObject({ error: { fields: ['estimatedUntil'] } });
  const nested = await put({ ...body, reason: { fa: ' ', en: 'private submitted message' } });
  expect(nested.status).toBe(400);
  const nestedBody = await nested.json();
  expect(nestedBody).toMatchObject({ error: { fields: ['reasonFa'] } });
  expect(JSON.stringify(nestedBody)).not.toContain('private submitted message');
  const mixed = await put({ ...body, owner: ' ', expectedVersion: 'private version' });
  expect(mixed.status).toBe(400);
  const mixedBody = await mixed.json();
  expect(mixedBody).not.toHaveProperty('error.fields');
  expect(JSON.stringify(mixedBody)).not.toContain('private version');
  const unknown = await put({
    ...body,
    reason: { ...body.reason, privateField: 'private submitted value' },
  });
  expect(unknown.status).toBe(400);
  const unknownBody = await unknown.json();
  expect(unknownBody).not.toHaveProperty('error.fields');
  expect(JSON.stringify(unknownBody)).not.toContain('private submitted value');
  await http.pool.query('UPDATE sessions SET step_up_verified_at=NULL WHERE session_id=$1', [
    session,
  ]);
  const stepUpDenied = await put({ ...body, reason: null });
  expect(stepUpDenied.status).toBe(403);
  expect(await stepUpDenied.json()).not.toHaveProperty('error.fields');
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
  const privateReason = { fa: 'دلیل خصوصی آزمایشی', en: 'INTERNAL_MAINTENANCE_REASON' };
  const privateInput = { ...body, reason: privateReason, publishReason: false, expectedVersion: 1 };
  const savedPrivate = await put(privateInput);
  expect(savedPrivate.status, http.logs()).toBe(200);
  const receipt = await savedPrivate.json();
  expect(receipt).toMatchObject({ active: true, reason: standardMaintenanceNotice, version: 2 });
  expect(JSON.stringify(receipt)).not.toContain(privateReason.en);
  const row = (
    await http.pool.query("SELECT value FROM app_config WHERE key='maintenance.saving_orders'")
  ).rows[0]!.value;
  expect(row).toEqual({
    active: true,
    reason: standardMaintenanceNotice,
    owner: body.owner,
    estimatedUntil: body.estimatedUntil,
  });
  const publicStatus = (await (await fetch(`${http.base}/api/maintenance`)).json()) as {
    capabilities: unknown[];
  };
  expect(publicStatus.capabilities).toContainEqual({
    capability: 'saving_orders',
    active: true,
    reason: null,
    estimatedUntil: body.estimatedUntil,
  });
  expect(JSON.stringify(publicStatus)).not.toContain(privateReason.en);
  const paused = await fetch(`${http.base}/api/saving/orders`, { method: 'POST' });
  expect(paused.status, http.logs()).toBe(503);
  const pausedBody = (await paused.json()) as { error: unknown };
  expect(pausedBody).toMatchObject({
    error: { capability: 'saving_orders', supportUrl: '/tickets' },
  });
  expect(pausedBody.error).not.toHaveProperty('reason');
  expect(JSON.stringify(pausedBody)).not.toContain(privateReason.en);
  const privateAudit = (
    await http.pool.query(
      "SELECT metadata::jsonb AS metadata FROM audit_log WHERE event='config_change' AND metadata::jsonb->>'key'='maintenance.saving_orders' AND metadata::jsonb->'next'->>'version'='2'"
    )
  ).rows;
  expect(privateAudit).toHaveLength(1);
  expect(privateAudit[0].metadata).toMatchObject({
    previous: { version: 1 },
    next: { active: true, version: 2, reason: standardMaintenanceNotice },
    privateReason,
  });
  expect((await put(privateInput)).status).toBe(409);

  const resumed = await put({
    active: false,
    reason: null,
    owner: null,
    estimatedUntil: null,
    expectedVersion: 2,
  });
  expect(resumed.status, http.logs()).toBe(200);
  expect(await resumed.json()).toMatchObject({ active: false, version: 3 });

  expect((await fetch(`${path}/history`)).status).toBe(401);
  const readHistory = (query = '') => fetch(`${path}/history${query}`, { headers });
  const revisions = await readHistory();
  expect(revisions.status, http.logs()).toBe(200);
  expect(revisions.headers.get('cache-control')).toContain('no-store');
  const history = await revisions.json();
  expect(history).toMatchObject({
    baseVersion: 3,
    items: [
      { setting: { active: true, version: 2, reason: standardMaintenanceNotice } },
      { setting: { active: true, version: 1, reason: body.reason } },
    ],
    draft: null,
  });
  expect(JSON.stringify(history)).not.toContain(privateReason.en);
  expect((await (await readHistory('?beforeVersion=2')).json()).items).toHaveLength(1);
  expect((await readHistory('?beforeVersion=invalid')).status).toBe(400);

  const stage = (input: unknown, base = path) =>
    fetch(`${base}/rollback-draft`, { method: 'POST', headers, body: JSON.stringify(input) });
  const command = { sourceId: history.items[0].id, expectedVersion: 3 };
  expect((await stage({ ...command, expectedVersion: 2 })).status).toBe(409);
  expect((await stage({ ...command, injected: true })).status).toBe(400);
  expect(
    (
      await stage(
        { ...command, expectedVersion: 0 },
        `${http.base}/api/admin/maintenance/solar_requests`
      )
    ).status
  ).toBe(404);
  const staged = await Promise.all([stage(command), stage(command)]);
  expect(
    staged.map(({ status }) => status),
    http.logs()
  ).toEqual([201, 201]);
  const [draft, repeated] = await Promise.all(staged.map((response) => response.json()));
  expect(repeated).toEqual(draft);
  expect(draft).toMatchObject({
    sourceId: command.sourceId,
    baseVersion: 3,
    setting: { active: true, version: 2, reason: standardMaintenanceNotice },
  });
  expect(JSON.stringify(draft)).not.toContain(privateReason.en);
  expect((await (await readHistory()).json()).draft).toEqual(draft);
  const availability = await (await fetch(`${http.base}/api/maintenance`)).json();
  expect(availability.capabilities).toContainEqual({
    capability: 'saving_orders',
    active: false,
    reason: null,
    estimatedUntil: null,
  });
  const rollback = {
    ...privateInput,
    expectedVersion: 3,
    rollbackDraftId: draft.id,
  };
  expect((await put({ ...rollback, estimatedUntil: '2000-01-01T00:00:00.000Z' })).status).toBe(400);
  expect((await put({ ...rollback, rollbackDraftId: randomUUID() })).status).toBe(409);
  const activation = await Promise.all([put(rollback), put(rollback)]);
  expect(activation.map(({ status }) => status).sort()).toEqual([200, 409]);
  expect(await activation.find(({ status }) => status === 200)!.json()).toMatchObject({
    active: true,
    version: 4,
    reason: standardMaintenanceNotice,
  });
  expect((await (await readHistory()).json()).draft).toBeNull();
  const rollbackAudit = (
    await http.pool.query(
      "SELECT event,metadata::jsonb AS metadata FROM audit_log WHERE id=$1 OR metadata::jsonb->>'rollbackDraftId'=$1 ORDER BY created_at",
      [draft.id]
    )
  ).rows;
  expect(rollbackAudit).toHaveLength(2);
  expect(rollbackAudit[0]).toMatchObject({
    event: 'maintenance.rollback_draft',
    metadata: { key: 'maintenance.saving_orders', sourceId: command.sourceId, baseVersion: 3 },
  });
  expect(rollbackAudit[1]).toMatchObject({
    event: 'config_change',
    metadata: {
      previous: { version: 3 },
      next: { version: 4 },
      rollbackDraftId: draft.id,
      restoredFromVersion: 2,
    },
  });

  await http.pool.query("UPDATE staff_roles SET permissions='[]' WHERE role_id='test-maintenance'");
  expect((await readHistory()).status).toBe(403);
  expect((await stage({ ...command, expectedVersion: 4 })).status).toBe(403);
  const forbidden = await put({ ...body, reason: null });
  expect(forbidden.status).toBe(403);
  expect(await forbidden.json()).not.toHaveProperty('error.fields');
});
