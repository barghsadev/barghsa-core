import { beforeEach, afterEach, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { startHttpFixture } from '../test/http-fixture.js';
let http: Awaited<ReturnType<typeof startHttpFixture>>;
let profileId: string, provinceId: string, cityId: string;
let headers: Record<string, string>;
beforeEach(async () => {
  http = await startHttpFixture(process.env.TEST_DATABASE_URL!);
  await http.pool.query(
    "INSERT INTO users(user_id,username,password_hash) VALUES ('profile-owner','owner@example.test','test-only')"
  );
  const session = randomUUID(),
    csrf = randomUUID();
  await http.pool.query(
    "INSERT INTO sessions(session_id,user_id,csrf_token,family_id,expires_at,idle_deadline) VALUES ($1,'profile-owner',$2,$3,NOW()+INTERVAL '1 day',NOW()+INTERVAL '30 minutes')",
    [session, csrf, randomUUID()]
  );
  headers = {
    Cookie: `barghsa_session=${session}`,
    'X-CSRF-Token': csrf,
    'Content-Type': 'application/json',
  };
  profileId = (
    await http.pool.query(
      "INSERT INTO profiles(user_id,profile_type,status,first_name,last_name) VALUES ('profile-owner','INDIVIDUAL','DRAFT','Original','Owner') RETURNING id"
    )
  ).rows[0].id;
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
const update = (body: unknown) =>
  fetch(`${http.base}/api/profiles/${profileId}`, {
    method: 'PUT',
    headers,
    body: JSON.stringify(body),
  });
const snapshot = async () =>
  (await http.pool.query('SELECT * FROM profiles WHERE id=$1', [profileId])).rows[0];
const waitForWrite = () =>
  expect
    .poll(async () =>
      Number(
        (
          await http.pool.query(
            `SELECT count(*) FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock' AND query LIKE '%FROM profiles WHERE id=$1 AND user_id=$2%'`
          )
        ).rows[0].count
      )
    )
    .toBe(1);
for (const change of ['verify', 'archive']) {
  it(`rechecks a profile ${change} after a self-edit waits for the row lock`, async () => {
    const client = await http.pool.connect();
    let editing: Promise<Response> | undefined;
    try {
      await client.query('BEGIN');
      await client.query(
        change === 'verify'
          ? "UPDATE profiles SET status='VERIFIED' WHERE id=$1"
          : 'UPDATE profiles SET archived=true WHERE id=$1',
        [profileId]
      );
      editing = update({ firstName: 'Overwritten' });
      await waitForWrite();
      await client.query('COMMIT');
      expect((await editing).status).toBe(change === 'verify' ? 403 : 404);
      expect((await snapshot()).first_name).toBe('Original');
      expect(
        (await http.pool.query("SELECT id FROM audit_log WHERE event='profile_self_updated'")).rows
      ).toHaveLength(0);
    } finally {
      await client.query('ROLLBACK');
      client.release();
      await editing;
    }
  });
}
it('retains the explicit exception for staff editing their own verified individual profile', async () => {
  await http.pool.query("UPDATE profiles SET status='VERIFIED' WHERE id=$1", [profileId]);
  expect((await update({ firstName: 'Blocked' })).status).toBe(403);
  await http.pool.query("UPDATE users SET is_staff=true WHERE user_id='profile-owner'");
  expect((await update({ firstName: 'Staff' })).status).toBe(200);
  expect((await snapshot()).first_name).toBe('Staff');
  expect(
    JSON.parse(
      (await http.pool.query("SELECT metadata FROM audit_log WHERE event='profile_self_updated'"))
        .rows[0].metadata
    )
  ).toMatchObject({ profileId, fields: ['firstName'] });
});
it('rolls back profile and new address changes on audit failure and rejects partial address inputs', async () => {
  expect((await update({ provinceId })).status).toBe(400);
  for (const body of [null, [], { firstName: [] }, { firstName: ' ' }, {}])
    expect((await update(body)).status).toBe(400);
  const before = await snapshot();
  await http.pool.query(
    "CREATE FUNCTION fail_profile_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'profile audit test failure'; END $$; CREATE TRIGGER fail_profile_audit BEFORE INSERT ON audit_log FOR EACH ROW EXECUTE FUNCTION fail_profile_audit()"
  );
  expect(
    (
      await update({
        firstName: 'Changed',
        provinceId,
        cityId,
        fullAddress: 'Street',
        postalCode: '1234567890',
      })
    ).status
  ).toBe(500);
  expect(await snapshot()).toEqual(before);
  expect((await http.pool.query('SELECT id FROM addresses')).rows).toHaveLength(0);
});
for (const type of ['INDIVIDUAL', 'LEGAL']) {
  it(`allows only one concurrent ${type} onboarding submission`, async () => {
    await http.pool.query('UPDATE profiles SET profile_type=$2 WHERE id=$1', [profileId, type]);
    const body =
      type === 'INDIVIDUAL'
        ? {
            firstName: 'Person',
            lastName: 'Owner',
            nationalId: '1234567891',
            provinceId,
            cityId,
            fullAddress: 'Street',
            postalCode: '1234567890',
          }
        : {
            legalName: 'Company',
            nationalIdentifier: '12345678901',
            registrationNumber: '123',
            representativeTitle: 'CEO',
            representativeRelationship: 'director',
            officialProvinceId: provinceId,
            officialCityId: cityId,
            officialFullAddress: 'Street',
            officialPostalCode: '1234567890',
          };
    const submit = () =>
      fetch(`${http.base}/api/onboarding/${type.toLowerCase()}/${profileId}`, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
      });
    const blocker = await http.pool.connect();
    let submitting: Promise<Response[]> | undefined;
    try {
      await blocker.query('BEGIN');
      await blocker.query('SELECT id FROM profiles WHERE id=$1 FOR UPDATE', [profileId]);
      submitting = Promise.all([submit(), submit()]);
      await expect
        .poll(async () =>
          Number(
            (
              await http.pool.query(
                `SELECT count(*) FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock' AND query LIKE '%UPDATE profiles%'`
              )
            ).rows[0].count
          )
        )
        .toBe(2);
      await blocker.query('COMMIT');
      expect((await submitting).map((response) => response.status).sort()).toEqual([200, 404]);
    } finally {
      await blocker.query('ROLLBACK');
      blocker.release();
      await submitting;
    }
    expect(
      (await http.pool.query('SELECT id FROM addresses WHERE profile_id=$1', [profileId])).rows
    ).toHaveLength(1);
    expect((await snapshot()).status).not.toBe('DRAFT');
  });
}
