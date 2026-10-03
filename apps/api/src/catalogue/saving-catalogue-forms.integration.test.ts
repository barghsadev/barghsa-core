import { afterAll, beforeAll, beforeEach, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { startHttpFixture } from '../test/http-fixture.js';
let http: Awaited<ReturnType<typeof startHttpFixture>>;
let headers: Record<string, string>, userId: string, hardwareId: string, planId: string;
beforeAll(async () => {
  http = await startHttpFixture(process.env.TEST_DATABASE_URL!);
  await http.pool.query(
    "INSERT INTO staff_roles(role_id,name,description,permissions) VALUES('saving-form-admin','Saving forms','Tests','[\"admin:catalogue:edit\"]')"
  );
}, 40000);
afterAll(async () => {
  await http?.close();
}, 15000);
function request(path: string, method = 'GET', body?: unknown) {
  return fetch(`${http.base}/api/admin/catalogue/${path}`, {
    method,
    headers,
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}
beforeEach(async () => {
  userId = randomUUID();
  const session = randomUUID(),
    csrf = randomUUID();
  await http.pool.query(
    "INSERT INTO users(user_id,username,password_hash,is_staff) VALUES($1,$2,'test-only',true)",
    [userId, userId + '@example.test']
  );
  await http.pool.query("INSERT INTO user_roles(user_id,role_id) VALUES($1,'saving-form-admin')", [
    userId,
  ]);
  await http.pool.query(
    "INSERT INTO sessions(session_id,user_id,csrf_token,family_id,expires_at,idle_deadline,step_up_verified_at) VALUES($1,$2,$3,$4,NOW()+INTERVAL '1 day',NOW()+INTERVAL '30 minutes',NOW())",
    [session, userId, csrf, randomUUID()]
  );
  headers = {
    Cookie: `barghsa_session=${session}`,
    'X-CSRF-Token': csrf,
    'Content-Type': 'application/json',
  };
  const hardware = await request('products', 'POST', {
    type: 'hardware',
    title: { fa: 'تجهیز', en: 'Device' },
    price: '100',
    status: 'inactive',
  });
  expect(hardware.status, http.logs()).toBe(201);
  hardwareId = ((await hardware.json()) as { id: string }).id;
  const plan = await request('products', 'POST', {
    type: 'saving_plan',
    title: { fa: 'طرح', en: 'Plan' },
    price: '100',
    status: 'inactive',
    hardwareIds: [hardwareId],
  });
  expect(plan.status, http.logs()).toBe(201);
  planId = ((await plan.json()) as { id: string }).id;
});
it.each([
  { title: ' ', body: 'PRIVATE_INVALID_BODY', fields: ['title'] },
  { title: 'PRIVATE_INVALID_TITLE', body: ' ', fields: ['body'] },
])('agreement exposes only owned fields $fields', async ({ title, body, fields }) => {
  const response = await request(`saving-plans/${planId}/agreements/draft`, 'POST', {
    title,
    body,
  });
  expect(response.status, http.logs()).toBe(400);
  const data = (await response.json()) as { error: { code: string; fields?: string[] } };
  expect(data.error).toMatchObject({ code: 'VALIDATION:INPUT:INVALID', fields });
  expect(JSON.stringify(data)).not.toContain('PRIVATE_INVALID');
  expect(
    (
      await http.pool.query('SELECT id FROM saving_plan_agreement_versions WHERE plan_id=$1', [
        planId,
      ])
    ).rows
  ).toHaveLength(0);
});
it.each([{ title: ' ', body: 'Valid', unknown: 'PRIVATE' }, null])(
  'agreement mixed or unowned invalid payload stays general',
  async (body) => {
    const response = await request(`saving-plans/${planId}/agreements/draft`, 'POST', body);
    expect(response.status).toBe(400);
    const data = (await response.json()) as { error: { code: string; fields?: string[] } };
    expect(data.error.code).toBe(
      body === null ? 'VALIDATION:INPUT:INVALID' : 'VALIDATION:PARSE:ZOD_ERROR'
    );
    expect(data.error.fields).toBeUndefined();
    expect(JSON.stringify(data)).not.toContain('PRIVATE');
  }
);
it('same draft returns its persisted text and identity without another version or audit, then activation returns immutable text', async () => {
  const path = `saving-plans/${planId}`;
  const first = await request(`${path}/agreements/draft`, 'POST', {
    title: '  Terms  ',
    body: '  Exact immutable agreement.  ',
  });
  expect(first.status, http.logs()).toBe(201);
  const receipt = (await first.json()) as { id: string };
  expect(receipt).toMatchObject({
    plan_id: planId,
    title: 'Terms',
    body: 'Exact immutable agreement.',
    status: 'draft',
    effective_from: null,
  });
  const second = await request(`${path}/agreements/draft`, 'POST', {
    title: 'Terms',
    body: 'Exact immutable agreement.',
  });
  expect(second.status).toBe(201);
  expect(await second.json()).toEqual(receipt);
  expect(
    (
      await http.pool.query(
        "SELECT id FROM audit_log WHERE user_id=$1 AND event='saving_plan_agreement_drafted'",
        [userId]
      )
    ).rows
  ).toHaveLength(1);
  const activated = await request(`${path}/agreements/${receipt.id}/activate`, 'POST');
  expect(activated.status).toBe(201);
  const published = (await activated.json()) as { effective_from: string };
  expect(published).toMatchObject({
    id: receipt.id,
    plan_id: planId,
    title: 'Terms',
    body: 'Exact immutable agreement.',
    status: 'active',
  });
  expect(Number.isFinite(Date.parse(published.effective_from))).toBe(true);
  expect(await (await request(`${path}/configuration`)).json()).toMatchObject({
    planId,
    agreements: [published],
  });
  await expect(
    http.pool.query("UPDATE saving_plan_agreement_versions SET body='edited' WHERE id=$1", [
      receipt.id,
    ])
  ).rejects.toMatchObject({ code: '23514' });
});
it.each([
  { stockTracking: 'PRIVATE', stockCount: 1, reservationMinutes: 5, field: 'stockTracking' },
  { stockTracking: true, stockCount: 1.1, reservationMinutes: 5, field: 'stockCount' },
  { stockTracking: true, stockCount: 1, reservationMinutes: 4, field: 'reservationMinutes' },
])('inventory exposes only owned field $field', async ({ field, ...body }) => {
  const response = await request(`hardware/${hardwareId}/inventory`, 'PUT', body);
  expect(response.status, http.logs()).toBe(400);
  const data = (await response.json()) as { error: { code: string; fields?: string[] } };
  expect(data.error).toMatchObject({ code: 'VALIDATION:INPUT:INVALID', fields: [field] });
  expect(JSON.stringify(data)).not.toContain('PRIVATE');
});
it('inventory unknown/mixed errors stay general', async () => {
  const response = await request(`hardware/${hardwareId}/inventory`, 'PUT', {
    stockTracking: true,
    stockCount: -1,
    reservationMinutes: 5,
    hardwareId: 'PRIVATE',
  });
  expect(response.status).toBe(400);
  const data = (await response.json()) as { error: { code: string; fields?: string[] } };
  expect(data.error.code).toBe('VALIDATION:PARSE:ZOD_ERROR');
  expect(data.error.fields).toBeUndefined();
});
it('inventory receipts identify hardware, reflect no-op and reservations, and failed conflicts leave no audit', async () => {
  const path = `hardware/${hardwareId}/inventory`,
    body = { stockTracking: true, stockCount: 10, reservationMinutes: 5 };
  const response = await request(path, 'PUT', body);
  expect(response.status, http.logs()).toBe(200);
  expect(await response.json()).toEqual({ hardwareId, ...body, reservedCount: 0 });
  await http.pool.query('UPDATE products SET reserved_count=2 WHERE id=$1', [hardwareId]);
  expect(await (await request(path)).json()).toEqual({ hardwareId, ...body, reservedCount: 2 });
  expect(await (await request(path, 'PUT', body)).json()).toEqual({
    hardwareId,
    ...body,
    reservedCount: 2,
  });
  for (const invalid of [
    { ...body, stockCount: 1 },
    { ...body, stockTracking: false },
  ]) {
    expect((await request(path, 'PUT', invalid)).status).toBe(409);
  }
  expect(
    (
      await http.pool.query(
        "SELECT id FROM audit_log WHERE user_id=$1 AND event='saving_inventory_configured'",
        [userId]
      )
    ).rows
  ).toHaveLength(1);
  expect(
    (
      await http.pool.query('SELECT stock_count,stock_tracking FROM products WHERE id=$1', [
        hardwareId,
      ])
    ).rows[0]
  ).toEqual({ stock_count: 10, stock_tracking: true });
});
it('revoked current permission wins over owned-field validation on both saving editors', async () => {
  await http.pool.query('DELETE FROM user_roles WHERE user_id=$1', [userId]);
  for (const [path, method, body] of [
    [`hardware/${hardwareId}/inventory`, 'PUT', { stockTracking: 'PRIVATE' }],
    [`saving-plans/${planId}/agreements/draft`, 'POST', { title: 'PRIVATE' }],
  ] as const) {
    const response = await request(path, method, body);
    expect(response.status, http.logs()).toBe(403);
    const data = (await response.json()) as { error: { code: string; fields?: string[] } };
    expect(data.error.fields).toBeUndefined();
    expect(JSON.stringify(data)).not.toContain('PRIVATE');
  }
});
it('expired step-up blocks writes without producing field feedback or modifying inventory', async () => {
  await http.pool.query('UPDATE sessions SET step_up_verified_at=NULL WHERE user_id=$1', [userId]);
  const response = await request(`hardware/${hardwareId}/inventory`, 'PUT', {
    stockTracking: true,
    stockCount: 5,
    reservationMinutes: 5,
  });
  expect(response.status).toBe(403);
  expect(((await response.json()) as { error: { code: string } }).error.code).toBe(
    'AUTHZ:STEP_UP_REQUIRED'
  );
  expect(
    (await http.pool.query('SELECT stock_count FROM products WHERE id=$1', [hardwareId])).rows[0]
      ?.stock_count
  ).toBe(0);
});
