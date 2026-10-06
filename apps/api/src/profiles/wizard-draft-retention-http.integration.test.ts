import { AuditWindow } from '../test/audit-window.js';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, expect, it } from 'vitest';
import { startHttpFixture } from '../test/http-fixture.js';

let http: Awaited<ReturnType<typeof startHttpFixture>>;
const headers: Record<string, Record<string, string>> = {};
const individualId = randomUUID();
const legalId = randomUUID();
const customerId = randomUUID();
const companyId = randomUUID();
const drafts = [
  {
    name: 'personal',
    table: 'profile_onboarding_drafts',
    profile: individualId,
    onboarding: true,
    path: `/api/onboarding/draft/${individualId}`,
    data: { firstName: 'Saved person' },
  },
  {
    name: 'company',
    table: 'profile_onboarding_drafts',
    profile: legalId,
    onboarding: true,
    path: `/api/onboarding/draft/${legalId}`,
    data: { legalName: 'Saved company' },
  },
  {
    name: 'simple',
    table: 'electricity_customer_drafts',
    profile: companyId,
    mode: 'simple',
    path: `/api/electricity/drafts/simple?profileId=${companyId}`,
    data: { period: 'next_week' },
  },
  {
    name: 'advanced',
    table: 'electricity_customer_drafts',
    profile: companyId,
    mode: 'advanced',
    path: `/api/electricity/drafts/advanced?profileId=${companyId}`,
    data: { quantities: { thermal: '10' } },
  },
  {
    name: 'saving',
    table: 'saving_customer_drafts',
    profile: customerId,
    path: `/api/saving/orders/draft?profileId=${customerId}`,
    data: { planId: '', hardwareId: '', billIdentifier: '1234', addressId: '', giftCode: '' },
  },
  {
    name: 'solar',
    table: 'solar_customer_drafts',
    profile: customerId,
    path: `/api/solar/requests/draft?profileId=${customerId}`,
    data: { buildingType: 'household', propertyForm: 'villa', siteDescription: 'Saved roof' },
  },
] as const;
type Draft = (typeof drafts)[number];

async function config(value: unknown) {
  await http.pool.query(
    `INSERT INTO app_config(key,value) VALUES('electricity.order_draft_ttl_days',$1::jsonb)
     ON CONFLICT(key) DO UPDATE SET value=EXCLUDED.value`,
    [JSON.stringify(value)]
  );
}
const read = (draft: Draft, user = 'owner') =>
  fetch(`${http.base}${draft.path}`, { headers: headers[user]! });
async function stored(draft: Draft) {
  return (
    await http.pool.query(
      `SELECT * FROM ${draft.table} WHERE profile_id=$1${'mode' in draft ? ' AND mode=$2' : ''}`,
      'mode' in draft ? [draft.profile, draft.mode] : [draft.profile]
    )
  ).rows;
}

beforeAll(async () => {
  http = await startHttpFixture(process.env.TEST_DATABASE_URL!);
  for (const user of ['owner', 'other']) {
    await http.pool.query(
      "INSERT INTO users(user_id,username,password_hash) VALUES($1,$2,'test-only')",
      [user, `${user}@example.test`]
    );
    const session = randomUUID(),
      csrf = randomUUID();
    await http.pool.query(
      `INSERT INTO sessions(session_id,user_id,csrf_token,family_id,expires_at,idle_deadline)
       VALUES($1,$2,$3,$4,NOW()+INTERVAL '1 day',NOW()+INTERVAL '30 minutes')`,
      [session, user, csrf, randomUUID()]
    );
    headers[user] = {
      Cookie: `barghsa_session=${session}`,
      'X-CSRF-Token': csrf,
      'Content-Type': 'application/json',
    };
  }
  for (const [id, type, status] of [
    [individualId, 'INDIVIDUAL', 'DRAFT'],
    [legalId, 'LEGAL', 'DRAFT'],
    [customerId, 'INDIVIDUAL', 'ACTIVE'],
    [companyId, 'LEGAL', 'ACTIVE'],
  ])
    await http.pool.query(
      "INSERT INTO profiles(id,user_id,profile_type,status,title) VALUES($1,'owner',$2,$3,'Keep this profile')",
      [id, type, status]
    );
}, 40_000);
afterAll(async () => {
  await http?.close();
}, 15_000);
beforeEach(async () => {
  await http.pool.query(
    "UPDATE sessions SET expires_at=NOW()+INTERVAL '1 day',idle_deadline=NOW()+INTERVAL '30 minutes'"
  );
  await http.pool.query(
    "UPDATE profiles SET is_default=false,archived=false WHERE user_id='owner'"
  );
  await http.pool.query(
    "UPDATE profiles SET status='DRAFT',title='Keep this profile',first_name=NULL,last_name=NULL,national_id=NULL WHERE id=ANY($1::uuid[])",
    [[individualId, legalId]]
  );
  await http.pool.query('DELETE FROM legal_profiles WHERE id=$1', [legalId]);
  await http.pool.query('DELETE FROM addresses WHERE profile_id=ANY($1::uuid[])', [
    [individualId, legalId],
  ]);
  await http.pool.query("DELETE FROM app_config WHERE key='electricity.order_draft_ttl_days'");
  await auditWindow.excludeExisting("event='onboarding_draft_expired'", []);
  for (const table of new Set(drafts.map((d) => d.table)))
    await http.pool.query(`DELETE FROM ${table}`);
  for (const draft of drafts) {
    if ('onboarding' in draft)
      await http.pool.query(
        "INSERT INTO profile_onboarding_drafts(profile_id,version,data,updated_at) VALUES($1,5,$2::jsonb,NOW()-INTERVAL '8 days')",
        [draft.profile, JSON.stringify(draft.data)]
      );
    else
      await http.pool.query(
        `INSERT INTO ${draft.table}(user_id,profile_id,current_step,data,updated_at${'mode' in draft ? ',mode' : ''})
       VALUES('owner',$1,2,$2::jsonb,NOW()-INTERVAL '8 days'${'mode' in draft ? ',$3' : ''})`,
        'mode' in draft
          ? [draft.profile, JSON.stringify(draft.data), draft.mode]
          : [draft.profile, JSON.stringify(draft.data)]
      );
  }
});

for (const draft of drafts) {
  it(`applies the default seven-day TTL to ${draft.name} drafts without deleting profiles`, async () => {
    const response = await read(draft);
    expect(response.status, http.logs()).toBe(200);
    expect(await response.json()).toMatchObject(
      'onboarding' in draft ? { version: 6, data: {} } : { currentStep: 1, data: null }
    );
    if ('onboarding' in draft) {
      expect((await stored(draft))[0]).toMatchObject({ version: 6, data: {} });
      expect(await (await read(draft)).json()).toEqual({ version: 6, data: {} });
      const audit = (
        await auditWindow.query(
          "SELECT metadata::jsonb AS metadata FROM audit_log WHERE event='onboarding_draft_expired' AND metadata::jsonb->>'profileId'=$1",
          [draft.profile]
        )
      ).rows;
      expect(audit).toEqual([{ metadata: { profileId: draft.profile, version: 6 } }]);
    } else expect(await stored(draft)).toEqual([]);
    expect(
      (await http.pool.query('SELECT title FROM profiles WHERE id=$1', [draft.profile])).rows[0]
        .title
    ).toBe('Keep this profile');
    for (const other of drafts.filter((d) => d.name !== draft.name))
      expect((await stored(other))[0].data).toEqual(other.data);
  });
  it(`uses live configured TTL and protects ${draft.name} drafts from other users and invalid settings`, async () => {
    const before = await stored(draft);
    expect((await read(draft, 'other')).status).toBe(404);
    expect(await stored(draft)).toEqual(before);
    for (const value of [null, '7', 0, 366, 1.5, true]) {
      await config(value);
      expect((await read(draft)).status).toBe(503);
      expect(await stored(draft)).toEqual(before);
    }
    await config(14);
    expect(await (await read(draft)).json()).toMatchObject({ data: draft.data });
    expect(await stored(draft)).toEqual(before);
    await config(1);
    expect(await (await read(draft)).json()).toMatchObject({
      data: 'onboarding' in draft ? {} : null,
    });
  });
}

for (const draft of [drafts[0], drafts[1]]) {
  it(`rejects expired ${draft.name} writes and submissions, then preserves version continuity after reload`, async () => {
    const save = (version: number) =>
      fetch(`${http.base}${draft.path}`, {
        method: 'PUT',
        headers: headers.owner!,
        body: JSON.stringify({ expectedVersion: version, data: draft.data }),
      });
    expect((await save(5)).status).toBe(409);
    const provinceId = (
      await http.pool.query('INSERT INTO provinces(name_fa,name_en) VALUES($1,$2) RETURNING id', [
        `استان ${draft.name}`,
        `Province ${draft.name}`,
      ])
    ).rows[0].id;
    const cityId = (
      await http.pool.query(
        "INSERT INTO cities(province_id,name_fa,name_en) VALUES($1,'شهر','City') RETURNING id",
        [provinceId]
      )
    ).rows[0].id;
    const body =
      draft.name === 'personal'
        ? {
            draftVersion: 5,
            firstName: 'Person',
            lastName: 'Owner',
            nationalId: '1234567891',
            provinceId,
            cityId,
            fullAddress: 'Street',
            postalCode: '1234567890',
          }
        : {
            draftVersion: 5,
            legalName: 'Company',
            nationalIdentifier: '12345678901',
            registrationNumber: '123',
            companyTypeId: 'limited-liability',
            representativeFirstName: 'Person',
            representativeLastName: 'Owner',
            representativeNationalId: '1234567891',
            representativeProvinceId: provinceId,
            representativeCityId: cityId,
            representativeFullAddress: 'Street',
            representativePostalCode: '1234567890',
            representativeTitle: 'CEO',
            representativeRelationship: 'director',
            officialProvinceId: provinceId,
            officialCityId: cityId,
            officialFullAddress: 'Street',
            officialPostalCode: '1234567890',
          };
    const submit = () =>
      fetch(
        `${http.base}/api/onboarding/${draft.name === 'personal' ? 'individual' : 'legal'}/${draft.profile}`,
        {
          method: 'POST',
          headers: headers.owner!,
          body: JSON.stringify(body),
        }
      );
    const rejected = await submit();
    expect(rejected.status, await rejected.clone().text()).toBe(409);
    expect(
      (await http.pool.query('SELECT status,title FROM profiles WHERE id=$1', [draft.profile]))
        .rows[0]
    ).toEqual({ status: 'DRAFT', title: 'Keep this profile' });
    expect(
      (await http.pool.query('SELECT id FROM addresses WHERE profile_id=$1', [draft.profile])).rows
    ).toEqual([]);
    expect(await (await read(draft)).json()).toEqual({ version: 6, data: {} });
    expect((await save(5)).status).toBe(409);
    const saved = await save(6);
    expect(saved.status, http.logs()).toBe(200);
    expect(await saved.json()).toEqual({ version: 7, data: draft.data });
    expect((await save(5)).status).toBe(409);
    body.draftVersion = 7;
    const submitted = await submit();
    expect(submitted.status, await submitted.clone().text()).toBe(200);
    expect(await stored(draft)).toEqual([]);
    expect((await read(draft)).status).toBe(404);
  });
}

it('expires concurrent onboarding reads once and rolls back failed expiry audit writes', async () => {
  const results = await Promise.all([read(drafts[0]), read(drafts[0])]);
  expect(results.map((response) => response.status)).toEqual([200, 200]);
  for (const response of results) expect(await response.json()).toEqual({ version: 6, data: {} });
  expect(
    (await auditWindow.query("SELECT id FROM audit_log WHERE event='onboarding_draft_expired'"))
      .rows
  ).toHaveLength(1);
  const before = await stored(drafts[1]);
  await http.pool.query(
    "CREATE FUNCTION fail_expiry_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'expiry audit test failure'; END $$; CREATE TRIGGER fail_expiry_audit BEFORE INSERT ON audit_log FOR EACH ROW WHEN(NEW.event='onboarding_draft_expired') EXECUTE FUNCTION fail_expiry_audit()"
  );
  try {
    expect((await read(drafts[1])).status).toBe(500);
    expect(await stored(drafts[1])).toEqual(before);
  } finally {
    await http.pool.query(
      'DROP TRIGGER fail_expiry_audit ON audit_log; DROP FUNCTION fail_expiry_audit()'
    );
  }
});

for (const action of ['read', 'save'] as const) {
  it(`rolls back onboarding ${action} when the session expires during its audit write`, async () => {
    if (action === 'save') await config(14);
    const before = await stored(drafts[0]);
    await http.pool.query(`CREATE SEQUENCE expiry_audit_reached;
      CREATE FUNCTION delay_expiry_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
        IF NEW.event IN ('onboarding_draft_expired','onboarding_draft_saved') THEN
          PERFORM nextval('expiry_audit_reached'); PERFORM pg_sleep(2.2);
        END IF; RETURN NEW; END $$;
      CREATE TRIGGER delay_expiry_audit BEFORE INSERT ON audit_log FOR EACH ROW EXECUTE FUNCTION delay_expiry_audit()`);
    await http.pool.query(
      "UPDATE sessions SET expires_at=clock_timestamp()+INTERVAL '2 seconds' WHERE user_id='owner'"
    );
    try {
      const response =
        action === 'read'
          ? await read(drafts[0])
          : await fetch(`${http.base}${drafts[0].path}`, {
              method: 'PUT',
              headers: headers.owner!,
              body: JSON.stringify({ expectedVersion: 5, data: { firstName: 'Lost edit' } }),
            });
      expect(
        (await http.pool.query('SELECT is_called FROM expiry_audit_reached')).rows[0].is_called
      ).toBe(true);
      expect(response.status, http.logs()).toBe(401);
      expect(await stored(drafts[0])).toEqual(before);
    } finally {
      await http.pool.query(
        "UPDATE sessions SET expires_at=NOW()+INTERVAL '1 day',idle_deadline=NOW()+INTERVAL '30 minutes' WHERE user_id='owner'"
      );
      await http.pool.query(
        'DROP TRIGGER delay_expiry_audit ON audit_log; DROP FUNCTION delay_expiry_audit(); DROP SEQUENCE expiry_audit_reached'
      );
    }
  });
}

it('does not expire an archived or submitted onboarding profile', async () => {
  await http.pool.query('UPDATE profiles SET archived=true WHERE id=$1', [individualId]);
  await http.pool.query("UPDATE profiles SET status='ACTIVE' WHERE id=$1", [legalId]);
  for (const draft of [drafts[0], drafts[1]]) {
    const before = await stored(draft);
    expect((await read(draft)).status).toBe(404);
    expect(await stored(draft)).toEqual(before);
  }
});

const auditWindow = new AuditWindow(() => http.pool);
