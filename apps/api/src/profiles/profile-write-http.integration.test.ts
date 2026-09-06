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
            companyTypeId: 'limited-liability',
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

it('requires saved identity and address before finalizing a draft and audits the transition once', async () => {
  const complete = () =>
    fetch(`${http.base}/api/onboarding/complete/${profileId}`, { method: 'POST', headers });
  expect((await complete()).status).toBe(400);
  expect((await snapshot()).status).toBe('DRAFT');
  expect(
    (
      await update({
        firstName: 'Person',
        lastName: 'Owner',
        nationalId: '1234567891',
        provinceId,
        cityId,
        fullAddress: 'Street',
        postalCode: '1234567890',
      })
    ).status
  ).toBe(200);
  expect((await snapshot()).status).toBe('DRAFT');
  const first = await complete();
  expect(first.status).toBe(200);
  const completed = await snapshot();
  expect(completed.status).toBe('ACTIVE');
  expect((await complete()).status).toBe(200);
  expect(await snapshot()).toEqual(completed);
  expect(
    (await http.pool.query("SELECT id FROM audit_log WHERE event='profile_onboarding_completed'"))
      .rows
  ).toHaveLength(1);
});
it('does not replace a concurrent verification decision while finalizing a draft', async () => {
  const client = await http.pool.connect();
  let completing: Promise<Response> | undefined;
  try {
    await client.query('BEGIN');
    await client.query("UPDATE profiles SET status='VERIFIED' WHERE id=$1", [profileId]);
    completing = fetch(`${http.base}/api/onboarding/complete/${profileId}`, {
      method: 'POST',
      headers,
    });
    await waitForWrite();
    await client.query('COMMIT');
    expect((await completing).status).toBe(200);
    expect((await snapshot()).status).toBe('VERIFIED');
    expect(
      (await http.pool.query("SELECT id FROM audit_log WHERE event='profile_onboarding_completed'"))
        .rows
    ).toHaveLength(0);
  } finally {
    await client.query('ROLLBACK');
    client.release();
    await completing;
  }
});
it('does not finalize a legal draft without its legal entity record', async () => {
  await http.pool.query("UPDATE profiles SET profile_type='LEGAL' WHERE id=$1", [profileId]);
  const response = await fetch(`${http.base}/api/onboarding/complete/${profileId}`, {
    method: 'POST',
    headers,
  });
  expect(response.status).toBe(400);
  expect((await snapshot()).status).toBe('DRAFT');
});

it('requires complete legal details and rejects invalid company and geography selections without writes', async () => {
  await http.pool.query("UPDATE profiles SET profile_type='LEGAL' WHERE id=$1", [profileId]);
  await http.pool.query(
    "INSERT INTO company_types(id,name_en,name_fa) VALUES ('test-company','Test','آزمایش')"
  );
  const body = {
    legalName: 'Company',
    nationalIdentifier: '12345678901',
    registrationNumber: '123',
    companyTypeId: 'test-company',
    representativeTitle: 'CEO',
    representativeRelationship: 'director',
    officialProvinceId: provinceId,
    officialCityId: cityId,
    officialFullAddress: 'Street',
    officialPostalCode: '1234567890',
  };
  const submit = (input: unknown) =>
    fetch(`${http.base}/api/onboarding/legal/${profileId}`, {
      method: 'POST',
      headers,
      body: JSON.stringify(input),
    });
  for (const key of [
    'companyTypeId',
    'officialProvinceId',
    'officialCityId',
    'officialFullAddress',
    'officialPostalCode',
  ]) {
    const incomplete: Record<string, unknown> = { ...body };
    delete incomplete[key];
    expect((await submit(incomplete)).status).toBe(400);
  }
  for (const input of [
    null,
    [],
    { ...body, legalName: [] },
    { ...body, companyTypeId: 'missing' },
    { ...body, officialCityId: randomUUID() },
    { ...body, officialCityId: 'bad' },
    { ...body, officialFullAddress: ' ' },
    { ...body, registrationDate: '2026-02-30' },
    { ...body, officialEmail: 'invalid' },
  ]) {
    expect((await submit(input)).status).toBe(400);
  }
  expect((await snapshot()).status).toBe('DRAFT');
  expect((await http.pool.query('SELECT id FROM legal_profiles')).rows).toHaveLength(0);
  expect((await http.pool.query('SELECT id FROM addresses')).rows).toHaveLength(0);
  expect((await submit(body)).status).toBe(200);
  expect(
    (
      await http.pool.query('SELECT id FROM addresses WHERE profile_id=$1 AND main_address', [
        profileId,
      ])
    ).rows
  ).toHaveLength(1);
});

it('does not finalize a legacy legal draft missing its required company type', async () => {
  await http.pool.query("UPDATE profiles SET profile_type='LEGAL' WHERE id=$1", [profileId]);
  await http.pool.query(
    "INSERT INTO legal_profiles(id,legal_name,national_identifier,registration_number,representative_title,representative_relationship,official_province_id,official_city_id,official_full_address,official_postal_code) VALUES ($1,'Company','12345678901','123','CEO','director',$2,$3,'Street','1234567890')",
    [profileId, provinceId, cityId]
  );
  await http.pool.query(
    "INSERT INTO addresses(profile_id,province_id,city_id,full_address,postal_code,main_address) VALUES ($1,$2,$3,'Street','1234567890',true)",
    [profileId, provinceId, cityId]
  );
  const complete = () =>
    fetch(`${http.base}/api/onboarding/complete/${profileId}`, { method: 'POST', headers });
  expect((await complete()).status).toBe(400);
  expect((await snapshot()).status).toBe('DRAFT');
  await http.pool.query(
    "UPDATE legal_profiles SET company_type_id='limited-liability' WHERE id=$1",
    [profileId]
  );
  expect((await complete()).status).toBe(200);
});

for (const includeCompletion of [false, true]) {
  it(`serializes default selection across concurrent ${includeCompletion ? 'creation and completion' : 'creations'}`, async () => {
    if (includeCompletion) {
      await http.pool.query("UPDATE profiles SET national_id='1234567891' WHERE id=$1", [
        profileId,
      ]);
      await http.pool.query(
        "INSERT INTO addresses(profile_id,province_id,city_id,full_address,postal_code,main_address) VALUES ($1,$2,$3,'Street','1234567890',true)",
        [profileId, provinceId, cityId]
      );
    }
    const client = await http.pool.connect();
    let requests: Promise<Response[]> | undefined;
    try {
      await client.query('BEGIN');
      await client.query("SELECT user_id FROM users WHERE user_id='profile-owner' FOR UPDATE");
      const create = () =>
        fetch(`${http.base}/api/onboarding/start`, {
          method: 'POST',
          headers,
          body: JSON.stringify({ profileType: 'LEGAL' }),
        });
      requests = Promise.all([
        create(),
        includeCompletion
          ? fetch(`${http.base}/api/onboarding/complete/${profileId}`, { method: 'POST', headers })
          : create(),
      ]);
      await expect
        .poll(async () =>
          Number(
            (
              await http.pool.query(
                "SELECT count(*) FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock' AND query='SELECT user_id FROM users WHERE user_id=$1 FOR UPDATE'"
              )
            ).rows[0].count
          )
        )
        .toBe(2);
      await client.query('COMMIT');
      expect((await requests).map((response) => response.status).sort()).toEqual(
        includeCompletion ? [200, 201] : [201, 201]
      );
      expect(
        (
          await http.pool.query(
            "SELECT id FROM profiles WHERE user_id='profile-owner' AND is_default"
          )
        ).rows
      ).toHaveLength(1);
      expect(
        (await http.pool.query("SELECT id FROM audit_log WHERE event='profile_draft_created'")).rows
      ).toHaveLength(includeCompletion ? 1 : 2);
    } finally {
      await client.query('ROLLBACK');
      client.release();
      await requests;
    }
  });
}
it('rolls back profile creation when its audit fails', async () => {
  await http.pool.query(
    "CREATE FUNCTION reject_draft_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'test audit failure'; END $$; CREATE TRIGGER reject_draft_audit BEFORE INSERT ON audit_log FOR EACH ROW WHEN (NEW.event='profile_draft_created') EXECUTE FUNCTION reject_draft_audit()"
  );
  const before = (await http.pool.query('SELECT id FROM profiles')).rows;
  const response = await fetch(`${http.base}/api/onboarding/start`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ profileType: 'LEGAL' }),
  });
  expect(response.status).toBe(500);
  expect((await http.pool.query('SELECT id FROM profiles')).rows).toEqual(before);
});

it('rejects malformed onboarding bodies and route IDs with validation responses', async () => {
  const send = (path: string, body: unknown) =>
    fetch(`${http.base}/api/onboarding/${path}`, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    });
  for (const body of [
    null,
    [],
    {},
    { profileType: [] },
    { profileType: 123 },
    { profileType: 'unknown' },
  ]) {
    expect((await send('start', body)).status).toBe(400);
  }
  const valid = {
    firstName: 'Person',
    lastName: 'Owner',
    nationalId: '1234567891',
    provinceId,
    cityId,
    fullAddress: 'Street',
    postalCode: '1234567890',
  };
  for (const body of [
    null,
    [],
    {},
    { ...valid, firstName: [] },
    { ...valid, lastName: 123 },
    { ...valid, title: {} },
    { ...valid, provinceId: 'bad' },
    { ...valid, cityId: 123 },
    { ...valid, fullAddress: ' ' },
    { ...valid, postalCode: 123 },
    { ...valid, nationalId: 123 },
  ]) {
    expect((await send(`individual/${profileId}`, body)).status).toBe(400);
  }
  for (const route of ['individual', 'legal', 'complete'])
    expect((await send(`${route}/bad`, valid)).status).toBe(400);
  expect((await snapshot()).status).toBe('DRAFT');
  expect((await http.pool.query('SELECT id FROM addresses')).rows).toHaveLength(0);
  expect((await send(`individual/${profileId}`, valid)).status).toBe(200);
});
