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
it.each(['create', 'update', 'delete', 'main'] as const)(
  'rolls back an address %s when the manager session expires during audit persistence',
  async (operation) => {
    const first = await create(),
      second = await create();
    const snapshot = async () =>
      (
        await http.pool.query('SELECT * FROM addresses WHERE profile_id=$1 ORDER BY id', [
          profileId,
        ])
      ).rows;
    const before = await snapshot();
    const auditBefore = (await http.pool.query('SELECT count(*)::int AS count FROM audit_log'))
      .rows[0].count;
    await http.pool.query(
      "CREATE SEQUENCE address_audit_reached; CREATE FUNCTION delay_address_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.event LIKE 'address_%' THEN PERFORM nextval('address_audit_reached'); PERFORM pg_sleep(2.2); END IF; RETURN NEW; END $$; CREATE TRIGGER delay_address_audit BEFORE INSERT ON audit_log FOR EACH ROW EXECUTE FUNCTION delay_address_audit()"
    );
    await http.pool.query(
      "UPDATE sessions SET expires_at=clock_timestamp()+INTERVAL '2 seconds' WHERE user_id='manager'"
    );
    const response =
      operation === 'create'
        ? await request('POST', '', 'manager', {
            provinceId,
            cityId,
            fullAddress: 'Late address',
            postalCode: '1234567890',
          })
        : operation === 'update'
          ? await request('PUT', '/' + second.id, 'manager', { fullAddress: 'Late change' })
          : operation === 'delete'
            ? await request('DELETE', '/' + second.id, 'manager')
            : await request('POST', '/' + second.id + '/set-main', 'manager');
    expect(
      (await http.pool.query('SELECT is_called FROM address_audit_reached')).rows[0].is_called
    ).toBe(true);
    expect(response.status, await response.clone().text()).toBe(401);
    expect(await snapshot()).toEqual(before);
    expect(
      (await http.pool.query('SELECT count(*)::int AS count FROM audit_log')).rows[0].count
    ).toBe(auditBefore);
    expect(before.find((row) => row.id === first.id).main_address).toBe(true);
  }
);
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
  const removed = (await http.pool.query('SELECT * FROM addresses WHERE id=$1', [second.id])).rows;
  expect(removed).toEqual([
    expect.objectContaining({
      id: second.id,
      full_address: 'Changed address',
      main_address: false,
      deleted_at: expect.any(Date),
    }),
  ]);
  expect(
    ((await (await request('GET')).json()) as { addresses: { id: string }[] }).addresses.map(
      (a) => a.id
    )
  ).toEqual([first.id]);
  expect(
    (await request('PUT', '/' + second.id, 'manager', { fullAddress: 'Resurrected' })).status
  ).toBe(404);
  expect((await request('POST', '/' + second.id + '/set-main', 'manager')).status).toBe(404);
  expect((await request('DELETE', '/' + second.id, 'manager')).status).toBe(404);
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
  const invalidPair = await request('POST', '', 'owner', payload);
  expect(invalidPair.status).toBe(400);
  expect(await invalidPair.json()).toMatchObject({ error: { fields: ['provinceId', 'cityId'] } });
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
  const listed = (await response.json()) as { addresses: Record<string, unknown>[] };
  expect(listed.addresses[0]).toMatchObject({
    provinceNameFa: 'استان',
    provinceNameEn: 'Province',
    cityNameFa: 'شهر',
    cityNameEn: 'City',
  });
});

it.each(['en', 'fa'])(
  'returns safe field identifiers for create/edit validation with no writes (%s)',
  async (locale) => {
    const original = await create();
    const before = (await http.pool.query('SELECT * FROM addresses WHERE id=$1', [original.id]))
      .rows[0];
    const auditBefore = (await http.pool.query('SELECT count(*)::int AS count FROM audit_log'))
      .rows[0].count;
    headers.owner!['Accept-Language'] = locale;
    for (const [method, suffix] of [
      ['POST', ''],
      ['PUT', `/${original.id}`],
    ]) {
      const response = await request(method!, suffix, 'owner', {
        provinceId: 'private-province-value',
        cityId: 'private-city-value',
        fullAddress: ' ',
        postalCode: 'private-postal-value',
      });
      expect(response.status).toBe(400);
      const text = await response.text();
      expect(text).not.toContain('private-');
      expect(text).not.toContain('issues');
      const body = JSON.parse(text);
      expect(body.error).toMatchObject({
        code: 'VALIDATION:INPUT:INVALID',
        message: locale === 'fa' ? 'مقدار ورودی نامعتبر است' : 'Invalid input value',
        fields: ['provinceId', 'cityId', 'fullAddress', 'postalCode'],
      });
      expect(response.headers.get('x-correlation-id')).toBe(body.error.correlationId);
    }
    expect(
      (await http.pool.query('SELECT * FROM addresses WHERE id=$1', [original.id])).rows[0]
    ).toEqual(before);
    expect(
      (await http.pool.query('SELECT count(*)::int AS count FROM audit_log')).rows[0].count
    ).toBe(auditBefore);
    const generic = await request('PUT', `/${original.id}`, 'owner', {});
    expect(await generic.json()).toMatchObject({
      error: expect.not.objectContaining({ fields: expect.anything() }),
    });
  }
);

type AddressFormReceipt = Omit<
  import('./profiles.service.js').AddressRow,
  'createdAt' | 'updatedAt'
> & {
  createdAt: string;
  updatedAt: string;
};
type AddressFormError = { error: { code: string; fields?: readonly string[] } };

it('address forms serialize first-main creation and replay original receipts after later main and geography changes', async () => {
  const command = {
    provinceId,
    cityId,
    fullAddress: 'Captured address',
    postalCode: '1234567890',
    mainAddress: false,
    idempotencyKey: randomUUID(),
  };
  const pair = await Promise.all([
    request('POST', '', 'manager', command),
    request('POST', '', 'manager', command),
  ]);
  for (const response of pair) expect(response.status, await response.clone().text()).toBe(201);
  const original = (await pair[0]!.json()) as AddressFormReceipt;
  expect(await pair[1]!.json()).toEqual(original);
  expect(original).toMatchObject({
    profileId,
    provinceId,
    cityId,
    fullAddress: command.fullAddress,
    postalCode: command.postalCode,
    mainAddress: true,
  });
  expect(original.createdAt).toEqual(expect.any(String));
  expect(original.updatedAt).toEqual(expect.any(String));
  expect(original).not.toHaveProperty('idempotencyKey');
  expect(
    (await http.pool.query('SELECT id FROM addresses WHERE profile_id=$1', [profileId])).rows
  ).toHaveLength(1);
  expect(
    (await http.pool.query("SELECT id FROM audit_log WHERE event='address_created'")).rows
  ).toHaveLength(1);
  const second = await create('manager');
  expect((await request('POST', '/' + second.id + '/set-main', 'manager')).status).toBe(200);
  await http.pool.query("UPDATE cities SET status='inactive' WHERE id=$1", [cityId]);
  const auditBefore = (await http.pool.query('SELECT count(*)::int AS count FROM audit_log'))
    .rows[0].count;
  const replay = await request('POST', '', 'manager', command);
  expect(replay.status).toBe(201);
  expect(await replay.json()).toEqual(original);
  expect(
    (
      await http.pool.query('SELECT id FROM addresses WHERE profile_id=$1 AND main_address', [
        profileId,
      ])
    ).rows
  ).toEqual([{ id: second.id }]);
  expect(
    (await http.pool.query('SELECT count(*)::int AS count FROM audit_log')).rows[0].count
  ).toBe(auditBefore);
  const conflict = await request('POST', '', 'manager', {
    ...command,
    fullAddress: 'PRIVATE altered',
  });
  expect(conflict.status).toBe(409);
  expect(await conflict.text()).not.toContain('PRIVATE');
  expect(
    (
      await http.pool.query(
        "SELECT idempotency_key FROM idempotency_keys WHERE entity_type='address:create'"
      )
    ).rows
  ).toHaveLength(1);
});

it('address forms replay original edits after later changes and deny deleted targets without resurrecting them', async () => {
  await create();
  const address = await create();
  const command = {
    provinceId,
    cityId,
    fullAddress: 'Captured edit',
    postalCode: '1234567890',
    idempotencyKey: randomUUID(),
  };
  const pair = await Promise.all([
    request('PUT', '/' + address.id, 'manager', command),
    request('PUT', '/' + address.id, 'manager', command),
  ]);
  for (const response of pair) expect(response.status, await response.clone().text()).toBe(200);
  const original = (await pair[0]!.json()) as AddressFormReceipt;
  expect(await pair[1]!.json()).toEqual(original);
  expect(original).toMatchObject({
    id: address.id,
    profileId,
    fullAddress: command.fullAddress,
    mainAddress: false,
  });
  expect(
    (await http.pool.query("SELECT id FROM audit_log WHERE event='address_updated'")).rows
  ).toHaveLength(1);
  await http.pool.query("UPDATE cities SET status='inactive' WHERE id=$1", [cityId]);
  expect(
    (await request('PUT', '/' + address.id, 'manager', { fullAddress: 'Later edit' })).status
  ).toBe(200);
  const replay = await request('PUT', '/' + address.id, 'manager', command);
  expect(replay.status).toBe(200);
  expect(await replay.json()).toEqual(original);
  expect(
    (await http.pool.query('SELECT full_address FROM addresses WHERE id=$1', [address.id])).rows
  ).toEqual([{ full_address: 'Later edit' }]);
  const changed = await request('PUT', '/' + address.id, 'manager', {
    ...command,
    postalCode: '1234567891',
  });
  expect(changed.status).toBe(409);
  expect(
    (await http.pool.query("SELECT id FROM audit_log WHERE event='address_updated'")).rows
  ).toHaveLength(2);
  expect((await request('DELETE', '/' + address.id, 'manager')).status).toBe(200);
  const hidden = await request('PUT', '/' + address.id, 'manager', command);
  expect(hidden.status).toBe(404);
  expect(await hidden.text()).not.toContain(command.fullAddress);
  expect(
    (await http.pool.query('SELECT deleted_at FROM addresses WHERE id=$1', [address.id])).rows[0]
      .deleted_at
  ).toBeInstanceOf(Date);
});

it('address forms keep actor-scoped receipts private after manager or session revocation', async () => {
  const command = {
    provinceId,
    cityId,
    fullAddress: 'Manager private capture',
    postalCode: '1234567890',
    idempotencyKey: randomUUID(),
  };
  const saved = await request('POST', '', 'manager', command);
  expect(saved.status).toBe(201);
  const original = (await saved.json()) as AddressFormReceipt;
  const owner = await request('POST', '', 'owner', command);
  expect(owner.status).toBe(201);
  expect((await owner.json()) as AddressFormReceipt).not.toMatchObject({ id: original.id });
  expect(
    (
      await http.pool.query(
        "SELECT idempotency_key FROM idempotency_keys WHERE entity_type='address:create'"
      )
    ).rows
  ).toHaveLength(2);
  await http.pool.query("DELETE FROM profile_agents WHERE profile_id=$1 AND user_id='manager'", [
    profileId,
  ]);
  for (const body of [command, { ...command, fullAddress: ' ' }]) {
    const denied = await request('POST', '', 'manager', body);
    expect(denied.status).toBe(404);
    const text = await denied.text();
    expect(text).not.toContain(command.fullAddress);
    expect(JSON.parse(text) as AddressFormError).toMatchObject({
      error: expect.not.objectContaining({ fields: expect.anything() }),
    });
  }
  await http.pool.query(
    "INSERT INTO profile_agents(profile_id,user_id,role) VALUES ($1,'manager','Manager')",
    [profileId]
  );
  const edit = { fullAddress: 'Manager private edit', idempotencyKey: randomUUID() };
  expect((await request('PUT', '/' + original.id, 'manager', edit)).status).toBe(200);
  await http.pool.query(
    "UPDATE sessions SET expires_at=clock_timestamp()-INTERVAL '1 second' WHERE user_id='manager'"
  );
  const expired = await request('PUT', '/' + original.id, 'manager', edit);
  expect(expired.status).toBe(401);
  expect(await expired.text()).not.toContain(edit.fullAddress);
  expect(
    (await http.pool.query("SELECT id FROM audit_log WHERE event='address_updated'")).rows
  ).toHaveLength(1);
});

it('address forms authorize owning string feedback before exposing fields and keep mixed failures generic', async () => {
  const address = await create();
  const valid = { provinceId, cityId, fullAddress: ' ', postalCode: '1234567890' };
  const auditBefore = (await http.pool.query('SELECT count(*)::int AS count FROM audit_log'))
    .rows[0].count;
  for (const [method, suffix] of [
    ['POST', ''],
    ['PUT', '/' + address.id],
  ]) {
    for (const user of ['finance', 'legal', 'stranger']) {
      const denied = await request(method!, suffix, user, valid);
      expect(denied.status).toBe(404);
      expect((await denied.json()) as AddressFormError).toMatchObject({
        error: expect.not.objectContaining({ fields: expect.anything() }),
      });
    }
    const owned = await request(method!, suffix, 'manager', valid);
    expect(owned.status).toBe(400);
    expect((await owned.json()) as AddressFormError).toMatchObject({
      error: { code: 'VALIDATION:INPUT:INVALID', fields: ['fullAddress'] },
    });
    for (const patch of [
      { profileId: 'PRIVATE' },
      { idempotencyKey: 'PRIVATE' },
      { fullAddress: [] },
      { postalCode: 123 },
    ]) {
      const response = await request(method!, suffix, 'manager', { ...valid, ...patch });
      expect(response.status).toBe(400);
      const text = await response.text();
      expect(text).not.toContain('PRIVATE');
      expect(JSON.parse(text) as AddressFormError).toMatchObject({
        error: expect.not.objectContaining({ fields: expect.anything() }),
      });
    }
  }
  expect(
    (await http.pool.query('SELECT count(*)::int AS count FROM audit_log')).rows[0].count
  ).toBe(auditBefore);
  expect((await http.pool.query('SELECT idempotency_key FROM idempotency_keys')).rows).toHaveLength(
    0
  );
});

it.each(['create', 'update'] as const)(
  'address forms roll back %s receipts and effects with audit failure before exact retry',
  async (operation) => {
    const address = operation === 'update' ? await create() : undefined;
    const before = (await http.pool.query('SELECT * FROM addresses ORDER BY id')).rows;
    const auditBefore = (await http.pool.query('SELECT count(*)::int AS count FROM audit_log'))
      .rows[0].count;
    const command =
      operation === 'create'
        ? {
            provinceId,
            cityId,
            fullAddress: 'Captured address',
            postalCode: '1234567890',
            idempotencyKey: randomUUID(),
          }
        : { fullAddress: 'Captured edit', idempotencyKey: randomUUID() };
    const invoke = () =>
      request(
        operation === 'create' ? 'POST' : 'PUT',
        address ? '/' + address.id : '',
        'manager',
        command
      );
    await http.pool.query(
      "CREATE FUNCTION fail_keyed_address_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'test keyed address audit failure'; END $$; CREATE TRIGGER fail_keyed_address_audit BEFORE INSERT ON audit_log FOR EACH ROW WHEN (NEW.event IN ('address_created','address_updated')) EXECUTE FUNCTION fail_keyed_address_audit()"
    );
    expect((await invoke()).status).toBe(500);
    expect((await http.pool.query('SELECT * FROM addresses ORDER BY id')).rows).toEqual(before);
    expect(
      (await http.pool.query('SELECT count(*)::int AS count FROM audit_log')).rows[0].count
    ).toBe(auditBefore);
    expect(
      (await http.pool.query('SELECT idempotency_key FROM idempotency_keys')).rows
    ).toHaveLength(0);
    await http.pool.query('DROP TRIGGER fail_keyed_address_audit ON audit_log');
    const retry = await invoke();
    expect(retry.status).toBe(operation === 'create' ? 201 : 200);
    expect((await retry.json()) as AddressFormReceipt).toMatchObject({
      profileId,
      fullAddress: command.fullAddress,
    });
    expect(
      (await http.pool.query('SELECT count(*)::int AS count FROM audit_log')).rows[0].count
    ).toBe(auditBefore + 1);
    expect(
      (await http.pool.query('SELECT idempotency_key FROM idempotency_keys')).rows
    ).toHaveLength(1);
  }
);
