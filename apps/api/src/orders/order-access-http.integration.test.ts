import { beforeEach, afterEach, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { startHttpFixture } from '../test/http-fixture.js';
let http: Awaited<ReturnType<typeof startHttpFixture>>;
let profileId: string;
let body: Record<string, unknown>;
const headers: Record<string, Record<string, string>> = {};
beforeEach(async () => {
  http = await startHttpFixture(process.env.TEST_DATABASE_URL!);
  for (const actor of [
    'owner',
    'manager',
    'finance',
    'legal',
    'stale-owner',
    'successor',
    'stranger',
  ]) {
    await http.pool.query('INSERT INTO users(user_id,username,password_hash) VALUES ($1,$2,$3)', [
      actor,
      `${actor}@orders.test`,
      'test-only',
    ]);
    const session = randomUUID(),
      csrf = randomUUID();
    await http.pool.query(
      "INSERT INTO sessions(session_id,user_id,csrf_token,family_id,expires_at,idle_deadline) VALUES ($1,$2,$3,$4,NOW()+INTERVAL '1 day',NOW()+INTERVAL '30 minutes')",
      [session, actor, csrf, randomUUID()]
    );
    headers[actor] = {
      Cookie: `barghsa_session=${session}`,
      'X-CSRF-Token': csrf,
      'Content-Type': 'application/json',
    };
  }
  profileId = (
    await http.pool.query(
      "INSERT INTO profiles(user_id,profile_type,status) VALUES ('owner','LEGAL','ACTIVE') RETURNING id"
    )
  ).rows[0].id;
  for (const [actor, role] of [
    ['manager', 'Manager'],
    ['finance', 'Finance'],
    ['legal', 'Legal'],
    ['stale-owner', 'Owner'],
  ])
    await http.pool.query('INSERT INTO profile_agents(profile_id,user_id,role) VALUES ($1,$2,$3)', [
      profileId,
      actor,
      role,
    ]);
  const productId = (
    await http.pool.query(
      `INSERT INTO products(type,system_key,title,status,price) VALUES ('electricity','thermal_electricity','{"en":"Thermal"}','active',100000) RETURNING id`
    )
  ).rows[0].id;
  const provinceId = (
    await http.pool.query(
      "INSERT INTO provinces(name_fa,name_en) VALUES ('استان','Province') RETURNING id"
    )
  ).rows[0].id;
  const cityId = (
    await http.pool.query(
      "INSERT INTO cities(province_id,name_fa,name_en) VALUES ($1,'شهر','City') RETURNING id",
      [provinceId]
    )
  ).rows[0].id;
  body = {
    profileId,
    productId,
    orderType: 'electricity',
    address: { provinceId, cityId, fullAddress: 'Order Street', postalCode: '1234567890' },
  };
}, 40000);
afterEach(async () => {
  await http?.close();
}, 15000);
const request = (actor: string, method: string, suffix = '', input?: unknown) =>
  fetch(`${http.base}/api/orders${suffix}`, {
    method,
    headers: headers[actor]!,
    ...(input !== undefined ? { body: JSON.stringify(input) } : {}),
  });
async function create(actor = 'owner') {
  const response = await request(actor, 'POST', '', body);
  expect(response.status, http.logs()).toBe(201);
  return ((await response.json()) as { id: string }).id;
}
it('allows the owner and Manager while excluding financial, legal and stale Owner memberships', async () => {
  const id = await create('manager');
  for (const actor of ['owner', 'manager']) {
    expect((await request(actor, 'GET', `/${id}`)).status).toBe(200);
    expect(await (await request(actor, 'GET')).json()).toMatchObject({
      orders: [expect.objectContaining({ id })],
    });
  }
  for (const actor of ['finance', 'legal', 'stale-owner', 'stranger']) {
    expect((await request(actor, 'POST', '', body)).status).toBe(404);
    expect((await request(actor, 'GET', `/${id}`)).status).toBe(404);
    expect(await (await request(actor, 'GET')).json()).toEqual({ orders: [] });
    expect((await request(actor, 'POST', `/${id}/cancel`)).status).toBe(404);
  }
  await http.pool.query(
    "INSERT INTO profile_agents(profile_id,user_id,role) VALUES ($1,'finance','Manager')",
    [profileId]
  );
  expect((await request('finance', 'GET', `/${id}`)).status).toBe(200);
  expect((await request('owner', 'POST', `/${id}/cancel`)).status).toBe(200);
  expect((await request('manager', 'POST', `/${id}/cancel`)).status).toBe(200);
  expect(
    (
      await http.pool.query(
        "SELECT event,user_id FROM audit_log WHERE event IN ('order_created','order_cancelled') ORDER BY created_at"
      )
    ).rows
  ).toEqual([
    { event: 'order_created', user_id: 'manager' },
    { event: 'order_cancelled', user_id: 'owner' },
  ]);
});
it('moves order access with current ownership, preserving the original actor on the order', async () => {
  const id = await create();
  await http.pool.query("UPDATE profiles SET user_id='successor' WHERE id=$1", [profileId]);
  expect((await request('owner', 'GET', `/${id}`)).status).toBe(404);
  expect((await request('owner', 'POST', `/${id}/cancel`)).status).toBe(404);
  expect(await (await request('owner', 'GET')).json()).toEqual({ orders: [] });
  expect((await request('successor', 'GET', `/${id}`)).status).toBe(200);
  expect((await request('successor', 'POST', `/${id}/cancel`)).status).toBe(200);
  expect(
    (await http.pool.query('SELECT user_id,status FROM orders WHERE id=$1', [id])).rows[0]
  ).toEqual({ user_id: 'owner', status: 'CANCELLED' });
});
for (const action of ['create', 'cancel']) {
  it(`rechecks Manager membership when ${action} waits behind role removal`, async () => {
    const id = action === 'cancel' ? await create('manager') : '';
    const client = await http.pool.connect();
    let pending: Promise<Response> | undefined;
    try {
      await client.query('BEGIN');
      await client.query('SELECT id FROM profiles WHERE id=$1 FOR UPDATE', [profileId]);
      await client.query("DELETE FROM profile_agents WHERE profile_id=$1 AND user_id='manager'", [
        profileId,
      ]);
      pending =
        action === 'create'
          ? request('manager', 'POST', '', body)
          : request('manager', 'POST', `/${id}/cancel`);
      await expect
        .poll(async () =>
          Number(
            (
              await http.pool.query(
                "SELECT count(*) FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock' AND query LIKE '%SELECT id,user_id,profile_type FROM profiles%'"
              )
            ).rows[0].count
          )
        )
        .toBe(1);
      await client.query('COMMIT');
      expect((await pending).status).toBe(404);
      expect((await http.pool.query('SELECT status FROM orders')).rows).toEqual(
        action === 'create' ? [] : [{ status: 'DRAFT' }]
      );
    } finally {
      await client.query('ROLLBACK');
      client.release();
      await pending;
    }
  });
}
it('rolls back creation and cancellation when their audits fail', async () => {
  await http.pool.query(
    "CREATE FUNCTION reject_order_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'test rollback'; END $$; CREATE TRIGGER reject_order_audit BEFORE INSERT ON audit_log FOR EACH ROW WHEN (NEW.event IN ('order_created','order_cancelled')) EXECUTE FUNCTION reject_order_audit()"
  );
  expect((await request('manager', 'POST', '', body)).status).toBe(500);
  expect((await http.pool.query('SELECT id FROM orders')).rows).toHaveLength(0);
  await http.pool.query('ALTER TABLE audit_log DISABLE TRIGGER reject_order_audit');
  const id = await create();
  await http.pool.query('ALTER TABLE audit_log ENABLE TRIGGER reject_order_audit');
  expect((await request('manager', 'POST', `/${id}/cancel`)).status).toBe(500);
  expect(
    (await http.pool.query('SELECT status FROM orders WHERE id=$1', [id])).rows[0].status
  ).toBe('DRAFT');
});
