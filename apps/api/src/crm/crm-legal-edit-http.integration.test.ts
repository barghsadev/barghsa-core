import { afterAll, beforeAll, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { startHttpFixture } from '../test/http-fixture.js';
import type { CrmLegalInfo, CrmProfileDetail } from './crm-v2.service.js';

let http: Awaited<ReturnType<typeof startHttpFixture>>;
let headers: Record<string, string>;
let identity = 0;
const province = randomUUID(),
  city = randomUUID(),
  otherProvince = randomUUID(),
  otherCity = randomUUID();
beforeAll(async () => {
  http = await startHttpFixture(process.env.TEST_DATABASE_URL!);
  await http.pool.query(
    "INSERT INTO users(user_id,username,password_hash) VALUES ('legal-editor','editor@example.test','fixture'),('legal-owner','owner@example.test','fixture')"
  );
  await http.pool.query(
    `INSERT INTO staff_roles(role_id,name,description,permissions) VALUES ('legal-editor','Legal editor','Fixture','["crm:read","crm:edit"]')`
  );
  await http.pool.query(
    "INSERT INTO user_roles(user_id,role_id) VALUES ('legal-editor','legal-editor')"
  );
  const session = randomUUID(),
    csrf = randomUUID();
  await http.pool.query(
    `INSERT INTO sessions(session_id,user_id,csrf_token,family_id,expires_at,idle_deadline,step_up_verified_at)
    VALUES ($1,'legal-editor',$2,$3,NOW()+INTERVAL '1 day',NOW()+INTERVAL '30 minutes',NOW())`,
    [session, csrf, randomUUID()]
  );
  headers = {
    Cookie: 'barghsa_session=' + session,
    'X-CSRF-Token': csrf,
    'Content-Type': 'application/json',
  };
  for (const [p, c, name] of [
    [province, city, 'Original'],
    [otherProvince, otherCity, 'New'],
  ]) {
    await http.pool.query('INSERT INTO provinces(id,name_fa,name_en) VALUES ($1,$2,$2)', [p, name]);
    await http.pool.query(
      'INSERT INTO cities(id,province_id,name_fa,name_en) VALUES ($1,$2,$3,$3)',
      [c, p, name]
    );
  }
  await http.pool.query(
    "INSERT INTO company_types(id,name_fa,name_en) VALUES ('legal-old','Original','Original'),('legal-new','New','New')"
  );
}, 40000);
afterAll(async () => http?.close());

const changes = {
  registrationNumber: 'New registry',
  companyTypeId: 'legal-new',
  registrationDate: '2024-02-29',
  economicCode: '123456',
  officialPhone: '021-26658042',
  officialEmail: 'office@example.test',
  officialProvinceId: otherProvince,
  officialCityId: otherCity,
  officialFullAddress: 'New official street',
  officialPostalCode: '2345678901',
  representativeHonorific: 'Dr',
  representativeFirstName: 'New first',
  representativeLastName: 'New last',
  representativeNationalId: '0010350829',
  representativeTitle: 'Director',
  representativeRelationship: 'Board member',
  representativeProvinceId: otherProvince,
  representativeCityId: otherCity,
  representativeFullAddress: 'New representative street',
  representativePostalCode: '3456789012',
};
async function detail(id: string) {
  const response = await fetch(http.base + '/api/crm/profiles/' + id, { headers });
  expect(response.status).toBe(200);
  return (await response.json()) as CrmProfileDetail;
}
async function setup() {
  const id = randomUUID();
  await http.pool.query(
    "INSERT INTO profiles(id,user_id,profile_type,status,title) VALUES ($1,'legal-owner','LEGAL','VERIFIED','Old title')",
    [id]
  );
  await http.pool.query(
    `INSERT INTO legal_profiles(id,legal_name,national_identifier,registration_number,company_type_id,official_province_id,official_city_id,representative_title,representative_relationship,updated_at)
    VALUES ($1,'Protected company',$2,'Old registry','legal-old',$3,$4,'Old title','Old relationship','2026-08-01T01:00:00.123456Z')`,
    [id, '1' + String(++identity).padStart(10, '0'), province, city]
  );
  return { id, original: (await detail(id)).legalInfo! };
}
const update = (id: string, legal: unknown, extra: Record<string, unknown> = {}) =>
  fetch(http.base + '/api/crm/profiles/' + id, {
    method: 'PUT',
    headers,
    body: JSON.stringify({ legal, ...extra }),
    signal: AbortSignal.timeout(10000),
  });
async function audits(id: string) {
  return (
    await http.pool.query(
      "SELECT user_id,metadata::jsonb AS metadata FROM audit_log WHERE event='profile_updated' AND metadata::jsonb->>'profileId'=$1",
      [id]
    )
  ).rows;
}
it('updates every editable legal field and base contacts atomically without altering protected identity or account login', async () => {
  const { id, original } = await setup();
  const other = await setup();
  expect(original.updatedAt).toBe('2026-08-01T01:00:00.123456Z');
  const response = await update(
    id,
    {
      expectedUpdatedAt: original.updatedAt,
      changes: { ...changes, officialEmail: '  OFFICE@example.test  ' },
    },
    { title: 'New title', email: 'profile@example.test' }
  );
  expect(response.status, http.logs()).toBe(200);
  const result = (await response.json()) as { legalInfo: CrmLegalInfo };
  expect(result).toMatchObject({
    updated: true,
    profile: { id, title: 'New title', contactEmail: 'profile@example.test' },
    user: { username: 'owner@example.test' },
    legalInfo: {
      ...changes,
      legalName: original.legalName,
      nationalIdentifier: original.nationalIdentifier,
      companyTypeName: { nameEn: 'New' },
      officialCityName: { nameEn: 'New' },
      representativeCityName: { nameEn: 'New' },
    },
  });
  expect(result.legalInfo.updatedAt).toMatch(/\.\d{6}Z$/);
  expect(result.legalInfo.updatedAt).not.toBe(original.updatedAt);
  expect((await detail(id)).legalInfo).toEqual(result.legalInfo);
  expect((await detail(other.id)).legalInfo).toEqual(other.original);
  expect(await audits(id)).toEqual([
    expect.objectContaining({
      user_id: 'legal-editor',
      metadata: expect.objectContaining({
        profileId: id,
        scope: 'profile_details',
        before: {
          title: 'Old title',
          email: null,
          legal: Object.fromEntries(
            Object.keys(changes).map((key) => [key, original[key as keyof CrmLegalInfo]])
          ),
        },
        after: { title: 'New title', email: 'profile@example.test', legal: changes },
      }),
    }),
  ]);
  const noop = await update(id, { expectedUpdatedAt: result.legalInfo.updatedAt, changes });
  expect(noop.status).toBe(200);
  const unchanged = (await noop.json()) as { legalInfo: CrmLegalInfo };
  expect(unchanged.legalInfo.updatedAt).toBe(result.legalInfo.updatedAt);
  expect(await audits(id)).toHaveLength(1);
});
it('allows one concurrent edit per exact legal version and rejects stale writes', async () => {
  const { id, original } = await setup();
  const results = await Promise.all(
    ['First', 'Second'].map((registrationNumber) =>
      update(id, { expectedUpdatedAt: original.updatedAt, changes: { registrationNumber } })
    )
  );
  expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
  expect(await audits(id)).toHaveLength(1);
});
for (const invalid of [
  { legalName: 'Bypass' },
  { nationalIdentifier: '12345678901' },
  { firstName: 'Bypass' },
  { documents: [] },
  { registrationNumber: '' },
  { registrationNumber: 'x'.repeat(51) },
  { officialEmail: 'bad' },
  { registrationDate: '2025-02-29' },
  { representativeNationalId: '1111111111' },
  { officialPostalCode: '123' },
  { representativeFirstName: null },
  { companyTypeId: 'missing' },
  { officialProvinceId: province, officialCityId: otherCity },
  { representativeProvinceId: province, representativeCityId: otherCity },
  {},
])
  it('rejects invalid or protected changes: ' + JSON.stringify(invalid).slice(0, 90), async () => {
    const { id, original } = await setup();
    const response = await update(
      id,
      { expectedUpdatedAt: original.updatedAt, changes: invalid },
      { title: 'Must roll back' }
    );
    expect(response.status, http.logs()).toBe(400);
    expect((await detail(id)).legalInfo).toEqual(original);
    expect((await detail(id)).profile.title).toBe('Old title');
    expect(await audits(id)).toEqual([]);
  });
it('permits unchanged inactive geography while rejecting newly selected inactive records', async () => {
  const { id } = await setup();
  await http.pool.query(
    'UPDATE legal_profiles SET official_province_id=UPPER(official_province_id),official_city_id=UPPER(official_city_id) WHERE id=$1',
    [id]
  );
  const original = (await detail(id)).legalInfo!;
  expect(original.officialProvinceId).toBe(province);
  expect(original.officialCityId).toBe(city);
  await http.pool.query("UPDATE provinces SET status='inactive' WHERE id=ANY($1::uuid[])", [
    [province, otherProvince],
  ]);
  try {
    expect(
      (
        await update(id, {
          expectedUpdatedAt: original.updatedAt,
          changes: {
            officialProvinceId: province,
            officialCityId: city,
            officialFullAddress: 'Corrected old street',
          },
        })
      ).status
    ).toBe(200);
    const current = (await detail(id)).legalInfo!;
    expect(
      (
        await update(id, {
          expectedUpdatedAt: current.updatedAt,
          changes: { officialProvinceId: otherProvince, officialCityId: otherCity },
        })
      ).status
    ).toBe(400);
    expect(await audits(id)).toHaveLength(1);
  } finally {
    await http.pool.query("UPDATE provinces SET status='active' WHERE id=ANY($1::uuid[])", [
      [province, otherProvince],
    ]);
  }
});
it('rolls back legal and profile updates if their audit cannot commit', async () => {
  const { id, original } = await setup();
  await http.pool.query(
    `CREATE FUNCTION reject_legal_edit_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.event='profile_updated' THEN RAISE EXCEPTION 'fixture audit failure'; END IF; RETURN NEW; END $$`
  );
  await http.pool.query(
    'CREATE TRIGGER reject_legal_edit_audit BEFORE INSERT ON audit_log FOR EACH ROW EXECUTE FUNCTION reject_legal_edit_audit()'
  );
  try {
    expect(
      (
        await update(
          id,
          { expectedUpdatedAt: original.updatedAt, changes },
          { title: 'Must roll back' }
        )
      ).status
    ).toBe(500);
    expect((await detail(id)).legalInfo).toEqual(original);
    expect((await detail(id)).profile.title).toBe('Old title');
  } finally {
    await http.pool.query('DROP TRIGGER reject_legal_edit_audit ON audit_log');
    await http.pool.query('DROP FUNCTION reject_legal_edit_audit()');
  }
  expect(await audits(id)).toEqual([]);
});
it('rechecks current permission after waiting for the profile lock', async () => {
  const { id, original } = await setup();
  const lock = await http.pool.connect();
  let request: Promise<Response> | undefined;
  try {
    await lock.query('BEGIN');
    await lock.query('SELECT id FROM profiles WHERE id=$1 FOR UPDATE', [id]);
    const pid = (await lock.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;
    request = update(id, { expectedUpdatedAt: original.updatedAt, changes });
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
    await http.pool.query(
      "UPDATE staff_roles SET permissions='[\"crm:read\"]' WHERE role_id='legal-editor'"
    );
    await lock.query('ROLLBACK');
    expect((await request).status).toBe(403);
    expect((await detail(id)).legalInfo).toEqual(original);
    expect(await audits(id)).toEqual([]);
  } finally {
    await lock.query('ROLLBACK');
    lock.release();
    await request?.catch(() => undefined);
    await http.pool.query(
      'UPDATE staff_roles SET permissions=\'["crm:read","crm:edit"]\' WHERE role_id=\'legal-editor\''
    );
  }
});
it('rejects archived and individual targets', async () => {
  const { id, original } = await setup();
  await http.pool.query('UPDATE profiles SET archived=true WHERE id=$1', [id]);
  expect((await update(id, { expectedUpdatedAt: original.updatedAt, changes })).status).toBe(409);
  await http.pool.query(
    "UPDATE profiles SET archived=false,profile_type='INDIVIDUAL' WHERE id=$1",
    [id]
  );
  expect((await update(id, { expectedUpdatedAt: original.updatedAt, changes })).status).toBe(400);
  expect(await audits(id)).toEqual([]);
});
