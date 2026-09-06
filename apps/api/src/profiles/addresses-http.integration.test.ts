import { afterEach, beforeEach, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { startHttpFixture } from '../test/http-fixture.js';
let http: Awaited<ReturnType<typeof startHttpFixture>>;
let profileId: string, provinceId: string, cityId: string;
const headers: Record<string, Record<string, string>> = {};
beforeEach(async () => {
  if (!process.env.TEST_DATABASE_URL) throw new Error('PostgreSQL setup did not run');
  http = await startHttpFixture(process.env.TEST_DATABASE_URL);
  for (const user of ['owner', 'manager', 'finance', 'legal', 'stranger']) {
    await http.pool.query('INSERT INTO users(user_id,username,password_hash) VALUES ($1,$2,$3)', [
      user,
      `${user}@example.test`,
      'test-only',
    ]);
    const session = randomUUID(),
      csrf = randomUUID();
    await http.pool.query(
      `INSERT INTO sessions(session_id,user_id,csrf_token,family_id,expires_at,idle_deadline)
   VALUES ($1,$2,$3,$4,NOW()+INTERVAL '1 day',NOW()+INTERVAL '30 minutes')`,
      [session, user, csrf, randomUUID()]
    );
    headers[user] = {
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
  for (const role of ['Manager', 'Finance', 'Legal'])
    await http.pool.query('INSERT INTO profile_agents(profile_id,user_id,role) VALUES ($1,$2,$3)', [
      profileId,
      role.toLowerCase(),
      role,
    ]);
  provinceId = (
    await http.pool.query(
      "INSERT INTO provinces(name_fa,name_en) VALUES ('استان','Province') RETURNING id"
    )
  ).rows[0].id;
  cityId = (
    await http.pool.query(
      "INSERT INTO cities(province_id,name_fa,name_en) VALUES ($1,'شهر','City') RETURNING id",
      [provinceId]
    )
  ).rows[0].id;
}, 40000);
afterEach(async () => {
  await http?.close();
}, 15000);
function request(method: string, suffix = '', user = 'owner', body?: unknown) {
  return fetch(`${http.base}/api/profiles/${profileId}/addresses${suffix}`, {
    method,
    headers: headers[user]!,
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}
async function create(user = 'owner') {
  const r = await request('POST', '', user, {
    provinceId,
    cityId,
    fullAddress: 'Original address',
    postalCode: '1234567890',
  });
  const body = (await r.json()) as { id: string; mainAddress: boolean };
  expect(r.status, JSON.stringify(body) + http.logs()).toBe(201);
  return body;
}
it('allows managers, automatically sets the first main address, and preserves order snapshots after edit/delete', async () => {
  const first = await create('manager'),
    second = await create('manager');
  expect(first.mainAddress).toBe(true);
  expect(second.mainAddress).toBe(false);
  const product = (
    await http.pool.query(
      `INSERT INTO products(type,title,status) VALUES ('hardware','{"en":"Fixture"}','active') RETURNING id`
    )
  ).rows[0].id;
  const order = (
    await http.pool.query(
      `INSERT INTO orders(user_id,profile_id,product_id,order_type,status,snapshot_province_id,snapshot_city_id,snapshot_full_address,snapshot_postal_code)
  VALUES ('owner',$1,$2,'solar','CONFIRMED',$3,$4,'Original address','1234567890') RETURNING *`,
      [profileId, product, provinceId, cityId]
    )
  ).rows[0];
  expect(
    (await request('PUT', `/${second.id}`, 'manager', { fullAddress: 'Changed address' })).status
  ).toBe(200);
  expect((await request('DELETE', `/${second.id}`, 'manager')).status).toBe(200);
  expect((await http.pool.query('SELECT * FROM orders WHERE id=$1', [order.id])).rows[0]).toEqual(
    order
  );
  expect((await http.pool.query('SELECT * FROM addresses WHERE id=$1', [second.id])).rows).toEqual(
    []
  );
  expect((await request('DELETE', `/${first.id}`, 'manager')).status).toBe(400);
  expect(
    (
      await http.pool.query(
        "SELECT count(*)::int AS count FROM audit_log WHERE event='address_deleted'"
      )
    ).rows[0].count
  ).toBe(1);
});
it('denies unrelated, finance, legal and removed manager address changes', async () => {
  const first = await create(),
    second = await create();
  for (const user of ['stranger', 'finance', 'legal']) {
    expect((await request('GET', '', user)).status).toBe(404);
    expect((await request('DELETE', `/${second.id}`, user)).status).toBe(404);
    expect((await request('POST', `/${second.id}/set-main`, user)).status).toBe(404);
  }
  await http.pool.query("DELETE FROM profile_agents WHERE profile_id=$1 AND user_id='manager'", [
    profileId,
  ]);
  expect((await request('DELETE', `/${second.id}`, 'manager')).status).toBe(404);
  expect(
    (
      await http.pool.query('SELECT id FROM addresses WHERE profile_id=$1 AND main_address', [
        profileId,
      ])
    ).rows
  ).toEqual([{ id: first.id }]);
});
it('serializes two main switches and deletion racing a switch', async () => {
  await create();
  const second = await create(),
    third = await create();
  const switched = await Promise.all(
    [second, third].map((a) => request('POST', `/${a.id}/set-main`))
  );
  expect(switched.map((r) => r.status)).toEqual([200, 200]);
  expect(
    (
      await http.pool.query(
        'SELECT count(*)::int AS count FROM addresses WHERE profile_id=$1 AND main_address',
        [profileId]
      )
    ).rows[0].count
  ).toBe(1);
  const extra = await create();
  const results = await Promise.all([
    request('POST', `/${extra.id}/set-main`),
    request('DELETE', `/${extra.id}`),
  ]);
  expect(results.every((r) => [200, 400, 404, 409].includes(r.status))).toBe(true);
  expect(
    (
      await http.pool.query(
        'SELECT count(*)::int AS count FROM addresses WHERE profile_id=$1 AND main_address',
        [profileId]
      )
    ).rows[0].count
  ).toBe(1);
});

it('rejects cross-province and inactive selections without changing addresses or audit history', async () => {
  const original = await create();
  const otherProvince = (
    await http.pool.query(
      "INSERT INTO provinces(name_fa,name_en) VALUES ('دیگر','Other') RETURNING id"
    )
  ).rows[0].id;
  const before = (await http.pool.query('SELECT * FROM addresses WHERE id=$1', [original.id]))
    .rows[0];
  const auditBefore = (await http.pool.query('SELECT count(*)::int AS count FROM audit_log'))
    .rows[0].count;
  const payload = {
    provinceId: otherProvince,
    cityId,
    fullAddress: 'Invalid pair',
    postalCode: '1234567890',
  };
  expect((await request('POST', '', 'owner', payload)).status).toBe(400);
  expect(
    (await request('PUT', `/${original.id}`, 'owner', { provinceId: otherProvince })).status
  ).toBe(400);
  await http.pool.query("UPDATE cities SET status='inactive' WHERE id=$1", [cityId]);
  expect((await request('POST', '', 'owner', { ...payload, provinceId })).status).toBe(400);
  expect((await request('PUT', `/${original.id}`, 'owner', { cityId })).status).toBe(400);
  await http.pool.query("UPDATE cities SET status='active' WHERE id=$1", [cityId]);
  await http.pool.query("UPDATE provinces SET status='inactive' WHERE id=$1", [provinceId]);
  expect((await request('POST', '', 'owner', { ...payload, provinceId })).status).toBe(400);
  expect(
    (await http.pool.query('SELECT * FROM addresses WHERE id=$1', [original.id])).rows[0]
  ).toEqual(before);
  expect(
    (await http.pool.query('SELECT count(*)::int AS count FROM audit_log')).rows[0].count
  ).toBe(auditBefore);
  // Historical geography remains intact; a text correction need not reselect a retired city.
  expect(
    (await request('PUT', `/${original.id}`, 'owner', { fullAddress: 'Corrected street' })).status
  ).toBe(200);
});

it('validates an address selection again after concurrent geography deactivation', async () => {
  const client = await http.pool.connect();
  let creating: Promise<Response> | undefined;
  try {
    await client.query('BEGIN');
    await client.query("UPDATE cities SET status='inactive' WHERE id=$1", [cityId]);
    creating = request('POST', '', 'owner', {
      provinceId,
      cityId,
      fullAddress: 'Blocked selection',
      postalCode: '1234567890',
    });
    await expect
      .poll(async () =>
        Number(
          (
            await http.pool.query(
              `SELECT count(*) FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock' AND query LIKE '%SELECT c.id FROM provinces p JOIN cities c%'`
            )
          ).rows[0].count
        )
      )
      .toBe(1);
    await client.query('COMMIT');
    expect((await creating).status).toBe(400);
    expect((await http.pool.query('SELECT id FROM addresses')).rows).toHaveLength(0);
    expect(
      (await http.pool.query("SELECT id FROM audit_log WHERE event='address_created'")).rows
    ).toHaveLength(0);
  } finally {
    await client.query('ROLLBACK');
    client.release();
    await creating;
  }
});

it('rejects malformed address fields and route IDs as client errors', async () => {
  const original = await create();
  const valid = { provinceId, cityId, fullAddress: 'Street', postalCode: '1234567890' };
  for (const body of [
    null,
    [],
    { ...valid, cityId: 123 },
    { ...valid, provinceId: 'invalid' },
    { ...valid, fullAddress: '   ' },
    { ...valid, mainAddress: 'yes' },
  ]) {
    expect((await request('POST', '', 'owner', body)).status).toBe(400);
  }
  for (const body of [
    {},
    { cityId: [] },
    { fullAddress: ' ' },
    { postalCode: 123 },
    { cityId: 'invalid' },
  ]) {
    expect((await request('PUT', `/${original.id}`, 'owner', body)).status).toBe(400);
  }
  expect((await request('DELETE', '/invalid')).status).toBe(400);
  expect((await request('POST', '/invalid/set-main')).status).toBe(400);
  const response = await request('GET');
  expect(response.status).toBe(200);
  expect((await response.json()).addresses[0]).toMatchObject({
    provinceNameFa: 'استان',
    provinceNameEn: 'Province',
    cityNameFa: 'شهر',
    cityNameEn: 'City',
  });
});
