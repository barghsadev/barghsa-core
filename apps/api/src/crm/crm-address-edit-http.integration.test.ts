import { afterAll, beforeAll, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { startHttpFixture } from '../test/http-fixture.js';
import type { CrmProfileAddress, CrmProfileDetail } from './crm-v2.service.js';
let http: Awaited<ReturnType<typeof startHttpFixture>>;
let headers: Record<string, string>;
const province = randomUUID(),
  city = randomUUID(),
  nextProvince = randomUUID(),
  nextCity = randomUUID();
beforeAll(async () => {
  http = await startHttpFixture(process.env.TEST_DATABASE_URL!);
  await http.pool.query(
    "INSERT INTO users(user_id,username,password_hash) VALUES ('address-editor','editor@example.test','fixture'),('address-owner','owner@example.test','fixture')"
  );
  await http.pool.query(
    "INSERT INTO staff_roles(role_id,name,description,permissions) VALUES ('address-editor','Address editor','Fixture','[\"crm:read\",\"crm:edit\"]')"
  );
  await http.pool.query(
    "INSERT INTO user_roles(user_id,role_id) VALUES ('address-editor','address-editor')"
  );
  const session = randomUUID(),
    csrf = randomUUID();
  await http.pool.query(
    `INSERT INTO sessions(session_id,user_id,csrf_token,family_id,expires_at,idle_deadline,step_up_verified_at)
    VALUES ($1,'address-editor',$2,$3,NOW()+INTERVAL '1 day',NOW()+INTERVAL '30 minutes',NOW())`,
    [session, csrf, randomUUID()]
  );
  headers = {
    Cookie: 'barghsa_session=' + session,
    'X-CSRF-Token': csrf,
    'Content-Type': 'application/json',
  };
  for (const [p, c, name] of [
    [province, city, 'Original'],
    [nextProvince, nextCity, 'Next'],
  ]) {
    await http.pool.query('INSERT INTO provinces(id,name_fa,name_en) VALUES ($1,$2,$2)', [p, name]);
    await http.pool.query(
      'INSERT INTO cities(id,province_id,name_fa,name_en) VALUES ($1,$2,$3,$3)',
      [c, p, name]
    );
  }
}, 40000);
afterAll(async () => http?.close());
async function setup() {
  const profileId = randomUUID(),
    addressId = randomUUID();
  await http.pool.query(
    "INSERT INTO profiles(id,user_id,profile_type,status,title) VALUES ($1,'address-owner','INDIVIDUAL','ACTIVE','Original title')",
    [profileId]
  );
  await http.pool.query(
    `INSERT INTO addresses(id,profile_id,province_id,city_id,full_address,postal_code,main_address,updated_at)
    VALUES ($1,$2,$3,$4,'Original street','1234567890',true,'2026-08-01T01:00:00.123456Z')`,
    [addressId, profileId, province, city]
  );
  const response = await fetch(http.base + '/api/crm/profiles/' + profileId, { headers });
  expect(response.status).toBe(200);
  const address = ((await response.json()) as CrmProfileDetail).addresses[0]!;
  return {
    profileId,
    address,
    edit: {
      id: addressId,
      expectedUpdatedAt: address.updatedAt,
      provinceId: nextProvince,
      cityId: nextCity,
      fullAddress: 'New street',
      postalCode: '2345678901',
    },
  };
}
const update = (profile: string, body: unknown, auth = headers) =>
  fetch(http.base + '/api/crm/profiles/' + profile, {
    method: 'PUT',
    headers: auth,
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(10000),
  });
async function audit(profile: string) {
  return (
    await http.pool.query(
      "SELECT user_id,metadata::jsonb AS metadata FROM audit_log WHERE event='profile_updated' AND metadata::jsonb->>'profileId'=$1",
      [profile]
    )
  ).rows;
}
it('commits profile and address changes together with authoritative before/after audit', async () => {
  const { profileId, edit, address } = await setup();
  expect(address.updatedAt).toBe('2026-08-01T01:00:00.123456Z');
  const other = await setup();
  const response = await update(profileId, {
    title: 'New title',
    email: 'office@example.test',
    address: { ...edit, fullAddress: '  New street  ' },
  });
  expect(response.status).toBe(200);
  const result = (await response.json()) as { address: CrmProfileAddress };
  expect(result).toMatchObject({
    updated: true,
    profile: { id: profileId, title: 'New title', contactEmail: 'office@example.test' },
    address: {
      id: address.id,
      provinceId: nextProvince,
      cityId: nextCity,
      fullAddress: 'New street',
      postalCode: edit.postalCode,
      mainAddress: true,
      provinceName: { nameEn: 'Next' },
      cityName: { nameEn: 'Next' },
    },
    user: { username: 'owner@example.test' },
  });
  expect(result.address.updatedAt).toMatch(/\.\d{6}Z$/);
  expect(result.address.updatedAt).not.toBe(edit.expectedUpdatedAt);
  expect(
    (await http.pool.query('SELECT full_address FROM addresses WHERE id=$1', [other.address.id]))
      .rows[0].full_address
  ).toBe('Original street');
  expect(await audit(profileId)).toEqual([
    expect.objectContaining({
      user_id: 'address-editor',
      metadata: expect.objectContaining({
        scope: 'profile_details',
        before: {
          title: 'Original title',
          email: null,
          address: {
            id: address.id,
            provinceId: province,
            cityId: city,
            fullAddress: 'Original street',
            postalCode: '1234567890',
          },
        },
        after: {
          title: 'New title',
          email: 'office@example.test',
          address: {
            id: address.id,
            provinceId: nextProvince,
            cityId: nextCity,
            fullAddress: 'New street',
            postalCode: '2345678901',
          },
        },
      }),
    }),
  ]);
});
it('keeps no-op edits idempotent and permits text repair at an unchanged inactive location', async () => {
  const { profileId, edit, address } = await setup();
  const unchanged = {
    ...edit,
    provinceId: province,
    cityId: city,
    fullAddress: address.fullAddress,
    postalCode: address.postalCode,
  };
  const initial = await update(profileId, { address: unchanged });
  expect(initial.status).toBe(200);
  expect(await initial.json()).toMatchObject({ address: { updatedAt: address.updatedAt } });
  expect(await audit(profileId)).toEqual([]);
  await http.pool.query("UPDATE cities SET status='inactive' WHERE id=$1", [city]);
  try {
    expect(
      (await update(profileId, { address: { ...unchanged, fullAddress: 'Repaired street' } }))
        .status
    ).toBe(200);
  } finally {
    await http.pool.query("UPDATE cities SET status='active' WHERE id=$1", [city]);
  }
});
it('rejects invalid address fields, identity edits and new inactive or unrelated geography atomically', async () => {
  const { profileId, edit } = await setup();
  for (const address of [
    { ...edit, id: 'invalid' },
    { ...edit, expectedUpdatedAt: 'not-a-date' },
    { ...edit, mainAddress: false },
    { ...edit, fullAddress: ' ' },
    { ...edit, fullAddress: 'x'.repeat(501) },
    { ...edit, postalCode: '0123456789' },
    { ...edit, cityId: city },
  ])
    expect((await update(profileId, { title: 'Must roll back', address })).status).toBe(400);
  expect((await update(profileId, { firstName: 'Identity bypass', address: edit })).status).toBe(
    400
  );
  await http.pool.query("UPDATE cities SET status='inactive' WHERE id=$1", [nextCity]);
  try {
    expect((await update(profileId, { title: 'Must roll back', address: edit })).status).toBe(400);
  } finally {
    await http.pool.query("UPDATE cities SET status='active' WHERE id=$1", [nextCity]);
  }
  expect(
    (await http.pool.query('SELECT title FROM profiles WHERE id=$1', [profileId])).rows[0].title
  ).toBe('Original title');
  expect(
    (await http.pool.query('SELECT full_address FROM addresses WHERE id=$1', [edit.id])).rows[0]
      .full_address
  ).toBe('Original street');
  expect(await audit(profileId)).toEqual([]);
});
it('rejects cross-profile, missing, stale and archived address edits', async () => {
  const target = await setup(),
    other = await setup();
  expect((await update(target.profileId, { address: other.edit })).status).toBe(404);
  expect(
    (await update(target.profileId, { address: { ...target.edit, id: randomUUID() } })).status
  ).toBe(404);
  const changed = await update(target.profileId, { address: target.edit });
  expect(changed.status).toBe(200);
  expect(
    (await update(target.profileId, { title: 'Stale overwrite', address: target.edit })).status
  ).toBe(409);
  expect(
    (await http.pool.query('SELECT title FROM profiles WHERE id=$1', [target.profileId])).rows[0]
      .title
  ).toBe('Original title');
  await http.pool.query(
    "UPDATE profiles SET archived=true,archived_at=NOW(),archived_reason='Fixture' WHERE id=$1",
    [other.profileId]
  );
  expect((await update(other.profileId, { address: other.edit })).status).toBe(409);
});
it('rolls back the address and contact if audit storage fails', async () => {
  const { profileId, edit } = await setup();
  await http.pool.query(
    "CREATE FUNCTION reject_address_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'fixture audit failure'; END $$; CREATE TRIGGER reject_address_audit BEFORE INSERT ON audit_log FOR EACH ROW WHEN (NEW.event='profile_updated') EXECUTE FUNCTION reject_address_audit()"
  );
  try {
    expect((await update(profileId, { title: 'Must roll back', address: edit })).status).toBe(500);
  } finally {
    await http.pool.query('DROP TRIGGER reject_address_audit ON audit_log');
  }
  expect(
    (await http.pool.query('SELECT full_address FROM addresses WHERE id=$1', [edit.id])).rows[0]
      .full_address
  ).toBe('Original street');
  expect(
    (await http.pool.query('SELECT title FROM profiles WHERE id=$1', [profileId])).rows[0].title
  ).toBe('Original title');
  expect(await audit(profileId)).toEqual([]);
});
it('enforces current staff access, CSRF and recent step-up on address edits', async () => {
  const { profileId, edit } = await setup();
  expect(
    (await update(profileId, { address: edit }, { 'Content-Type': 'application/json' })).status
  ).toBe(401);
  expect(
    (await update(profileId, { address: edit }, { ...headers, 'X-CSRF-Token': 'wrong' })).status
  ).toBe(403);
  await http.pool.query(
    "UPDATE sessions SET step_up_verified_at=NULL WHERE user_id='address-editor'"
  );
  expect((await update(profileId, { address: edit })).status).toBe(403);
  await http.pool.query(
    "UPDATE sessions SET step_up_verified_at=NOW() WHERE user_id='address-editor'"
  );
  await http.pool.query("DELETE FROM user_roles WHERE user_id='address-editor'");
  try {
    expect((await update(profileId, { address: edit })).status).toBe(403);
  } finally {
    await http.pool.query(
      "INSERT INTO user_roles(user_id,role_id) VALUES ('address-editor','address-editor')"
    );
  }
  expect(await audit(profileId)).toEqual([]);
});
it('rechecks permissions after waiting for the profile lock', async () => {
  const { profileId, edit } = await setup();
  const blocker = await http.pool.connect();
  let request: Promise<Response> | undefined;
  try {
    await blocker.query('BEGIN');
    await blocker.query('SELECT id FROM profiles WHERE id=$1 FOR UPDATE', [profileId]);
    const pid = (await blocker.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;
    request = update(profileId, { address: edit });
    await expect
      .poll(
        async () =>
          (
            await http.pool.query(
              'SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE $1::integer=ANY(pg_blocking_pids(pid))) AS waiting',
              [pid]
            )
          ).rows[0].waiting
      )
      .toBe(true);
    await http.pool.query("DELETE FROM user_roles WHERE user_id='address-editor'");
    await blocker.query('ROLLBACK');
    expect((await request).status).toBe(403);
    expect(await audit(profileId)).toEqual([]);
    expect(
      (await http.pool.query('SELECT full_address FROM addresses WHERE id=$1', [edit.id])).rows[0]
        .full_address
    ).toBe('Original street');
  } finally {
    await blocker.query('ROLLBACK');
    blocker.release();
    await request?.catch(() => undefined);
    await http.pool.query(
      "INSERT INTO user_roles(user_id,role_id) VALUES ('address-editor','address-editor') ON CONFLICT DO NOTHING"
    );
  }
});

it('allows only one simultaneous save of the same address revision', async () => {
  const { profileId, edit } = await setup();
  const replies = await Promise.all(
    ['First change', 'Second change'].map((fullAddress) =>
      update(profileId, { address: { ...edit, fullAddress } })
    )
  );
  expect(replies.map((reply) => reply.status).sort()).toEqual([200, 409]);
  expect(await audit(profileId)).toHaveLength(1);
  expect(['First change', 'Second change']).toContain(
    (await http.pool.query('SELECT full_address FROM addresses WHERE id=$1', [edit.id])).rows[0]
      .full_address
  );
});
