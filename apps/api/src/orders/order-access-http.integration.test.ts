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
                "SELECT count(*) FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock' AND query LIKE '%SELECT id,user_id,profile_type,status FROM profiles%'"
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

it.each([
  ['MANUAL', 'ACTIVE', false, 403],
  ['API', 'PENDING_VERIFICATION', false, 403],
  ['DISABLED', 'ACTIVE', true, 201],
  ['DISABLED', 'PENDING_VERIFICATION', true, 201],
  ['DISABLED', 'DRAFT', false, 403],
  ['DISABLED', 'SUSPENDED', false, 403],
  ['MANUAL', 'VERIFIED', true, 201],
  ['invalid-mode', 'ACTIVE', false, 403],
  [null, 'ACTIVE', true, 403],
  [null, 'ACTIVE', false, 201],
])(
  'enforces target profile verification with mode=%s status=%s legacy=%s',
  async (mode, status, legacyRequired, expected) => {
    await http.pool.query('UPDATE profiles SET status=$2 WHERE id=$1', [profileId, status]);
    // A verified default must not authorize a different, unverified submitted profile.
    await http.pool.query(
      "INSERT INTO profiles(user_id,profile_type,status,is_default) VALUES ('owner','INDIVIDUAL','VERIFIED',true)"
    );
    await http.pool.query(
      `INSERT INTO app_config(key,value) VALUES ('profile_verification_mode',$1::jsonb),('verification.required',$2::jsonb) ON CONFLICT(key) DO UPDATE SET value=EXCLUDED.value`,
      [JSON.stringify(mode), JSON.stringify(legacyRequired)]
    );
    const response = await request('owner', 'POST', '', body);
    expect(response.status, await response.clone().text()).toBe(expected);
    if (expected === 403)
      expect(await response.json()).toMatchObject({
        error: { code: 'AUTHZ:PROFILE_NOT_VERIFIED' },
      });
    expect((await http.pool.query('SELECT id FROM orders')).rows).toHaveLength(
      expected === 201 ? 1 : 0
    );
    expect(
      (await http.pool.query("SELECT id FROM audit_log WHERE event='order_created'")).rows
    ).toHaveLength(expected === 201 ? 1 : 0);
  }
);

it.each([
  ['create', false],
  ['cancel', false],
  ['create', true],
  ['cancel', true],
] as const)(
  'rolls back order %s if the caller session expires during its audit (gift=%s)',
  async (action, gift) => {
    if (gift) {
      await http.pool.query(
        "INSERT INTO gift_codes(code,discount_type,discount_value,valid_from,created_by) VALUES ('EXPIRY','fixed_irr',1000,'2026-01-01','owner')"
      );
      body.giftCode = 'EXPIRY';
    }
    const id = action === 'cancel' ? await create() : '';
    const before = (await http.pool.query('SELECT * FROM orders ORDER BY id')).rows;
    const auditBefore = (await http.pool.query('SELECT * FROM audit_log ORDER BY id')).rows;
    const giftsBefore = (await http.pool.query('SELECT * FROM gift_code_redemptions ORDER BY id'))
      .rows;
    await http.pool.query(
      "CREATE SEQUENCE order_audit_reached; CREATE FUNCTION delay_order_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.event IN ('order_created','order_cancelled') THEN PERFORM nextval('order_audit_reached'); PERFORM pg_sleep(2.2); END IF; RETURN NEW; END $$; CREATE TRIGGER delay_order_audit BEFORE INSERT ON audit_log FOR EACH ROW EXECUTE FUNCTION delay_order_audit()"
    );
    await http.pool.query(
      "UPDATE sessions SET expires_at=clock_timestamp()+INTERVAL '2 seconds' WHERE user_id='manager'"
    );
    const response =
      action === 'create'
        ? await request('manager', 'POST', '', body)
        : await request('manager', 'POST', '/' + id + '/cancel');
    expect(
      (await http.pool.query('SELECT is_called FROM order_audit_reached')).rows[0].is_called
    ).toBe(true);
    expect(response.status, await response.clone().text()).toBe(401);
    expect((await http.pool.query('SELECT * FROM orders ORDER BY id')).rows).toEqual(before);
    expect((await http.pool.query('SELECT * FROM audit_log ORDER BY id')).rows).toEqual(
      auditBefore
    );
    expect((await http.pool.query('SELECT * FROM gift_code_redemptions ORDER BY id')).rows).toEqual(
      giftsBefore
    );
  }
);

it.each(['profile', 'policy'])(
  'rechecks commercial %s after a database lock wait',
  async (change) => {
    await http.pool.query(
      "INSERT INTO app_config(key,value) VALUES ('profile_verification_mode',$1::jsonb)",
      [JSON.stringify(change === 'profile' ? 'MANUAL' : 'DISABLED')]
    );
    if (change === 'profile')
      await http.pool.query("UPDATE profiles SET status='VERIFIED' WHERE id=$1", [profileId]);
    const blocker = await http.pool.connect();
    let pending: Promise<Response> | undefined;
    try {
      await blocker.query('BEGIN');
      if (change === 'profile')
        await blocker.query("UPDATE profiles SET status='PENDING_VERIFICATION' WHERE id=$1", [
          profileId,
        ]);
      else
        await blocker.query(
          "UPDATE app_config SET value='\"MANUAL\"'::jsonb WHERE key='profile_verification_mode'"
        );
      pending = request('owner', 'POST', '', body);
      const queryPattern =
        change === 'profile'
          ? '%SELECT id,user_id,profile_type,status FROM profiles%'
          : 'LOCK TABLE app_config IN SHARE MODE';
      await expect
        .poll(async () =>
          Number(
            (
              await http.pool.query(
                "SELECT count(*) FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock' AND query LIKE $1",
                [queryPattern]
              )
            ).rows[0].count
          )
        )
        .toBe(1);
      await blocker.query('COMMIT');
      expect((await pending).status).toBe(403);
      expect((await http.pool.query('SELECT id FROM orders')).rows).toHaveLength(0);
    } finally {
      await blocker.query('ROLLBACK');
      blocker.release();
      await pending;
    }
  }
);

it('keeps copied order addresses and existing-order access after saved-address removal and verification enforcement', async () => {
  const address = body.address as Record<string, string>;
  const saved = async () => {
    const response = await fetch(http.base + '/api/profiles/' + profileId + '/addresses', {
      method: 'POST',
      headers: headers.manager!,
      body: JSON.stringify(address),
    });
    expect(response.status).toBe(201);
    return (await response.json()) as { id: string };
  };
  await saved();
  const second = await saved();
  const correlationId = randomUUID();
  headers.manager!['X-Correlation-Id'] = correlationId;
  const id = await create('manager');
  const original = await (await request('owner', 'GET', '/' + id)).json();
  expect(original).toMatchObject({
    snapshotProvinceId: address.provinceId,
    snapshotCityId: address.cityId,
    snapshotFullAddress: address.fullAddress,
    snapshotPostalCode: address.postalCode,
  });
  expect(
    (await http.pool.query("SELECT correlation_id FROM audit_log WHERE event='order_created'"))
      .rows[0].correlation_id
  ).toBe(correlationId);
  const path = http.base + '/api/profiles/' + profileId + '/addresses/' + second.id;
  expect(
    (
      await fetch(path, {
        method: 'PUT',
        headers: headers.manager!,
        body: JSON.stringify({ fullAddress: 'Changed after ordering' }),
      })
    ).status
  ).toBe(200);
  expect((await fetch(path, { method: 'DELETE', headers: headers.manager! })).status).toBe(200);
  await http.pool.query(
    "INSERT INTO app_config(key,value) VALUES ('profile_verification_mode','\"MANUAL\"'::jsonb)"
  );
  await http.pool.query("UPDATE profiles SET status='PENDING_VERIFICATION' WHERE id=$1", [
    profileId,
  ]);
  expect((await request('manager', 'POST', '', body)).status).toBe(403);
  expect(await (await request('manager', 'GET', '/' + id)).json()).toEqual(original);
  expect(await (await request('manager', 'GET')).json()).toMatchObject({ orders: [original] });
  expect((await request('manager', 'POST', '/' + id + '/cancel')).status).toBe(200);
  expect(
    (
      await http.pool.query('SELECT full_address,deleted_at FROM addresses WHERE id=$1', [
        second.id,
      ])
    ).rows[0]
  ).toMatchObject({ full_address: 'Changed after ordering', deleted_at: expect.any(Date) });
});
