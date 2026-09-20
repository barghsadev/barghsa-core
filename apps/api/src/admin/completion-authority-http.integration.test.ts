import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, expect, it } from 'vitest';
import { startHttpFixture } from '../test/http-fixture.js';

let http: Awaited<ReturnType<typeof startHttpFixture>>;
const sessionId = randomUUID();
const csrf = randomUUID();
const jobId = randomUUID();
const exceptionId = randomUUID();
const provinceId = randomUUID();
beforeAll(async () => {
  http = await startHttpFixture(process.env.TEST_DATABASE_URL!);
  await http.pool.query(`INSERT INTO users(user_id,username,password_hash,is_admin,is_staff)
    VALUES ('sprint-admin','sprint-admin@example.test','test-only',true,true)`);
  await http.pool.query(
    `INSERT INTO sessions(session_id,user_id,csrf_token,family_id,expires_at,idle_deadline,step_up_verified_at)
    VALUES ($1,'sprint-admin',$2,$3,NOW()+INTERVAL '1 day',NOW()+INTERVAL '30 minutes',NOW())`,
    [sessionId, csrf, randomUUID()]
  );
  await http.pool.query(
    "INSERT INTO background_jobs(id,job_type) VALUES ($1,'service_breach_scan')",
    [jobId]
  );
  await http.pool.query(
    "INSERT INTO reconciliation_exceptions(id,exception_type,description) VALUES ($1,'wallet_mismatch','Fixture mismatch')",
    [exceptionId]
  );
  await http.pool.query("INSERT INTO provinces(id,name_fa,name_en) VALUES ($1,'تست','Fixture')", [
    provinceId,
  ]);
}, 40000);
afterAll(async () => {
  await http?.close();
});
beforeEach(async () => {
  await http.pool.query(
    `UPDATE sessions SET revoked_at=NULL,csrf_token=$1,step_up_verified_at=clock_timestamp(),
    expires_at=clock_timestamp()+INTERVAL '1 day',idle_deadline=clock_timestamp()+INTERVAL '30 minutes'
    WHERE session_id=$2`,
    [csrf, sessionId]
  );
});

const actions = [
  {
    name: 'green rules',
    path: 'config/green-electricity-rules',
    method: 'PUT',
    stepUp: true,
    body: {
      simple_order: {
        mandatory_green_enabled: false,
        average_power_threshold_kw: 1000,
        mandatory_green_share_percent: 4,
      },
      advanced_order: {
        mandatory_green_enabled: false,
        average_power_threshold_kw: 1000,
        mandatory_green_share_percent: 4,
      },
    },
  },
  {
    name: 'contract limits',
    path: 'config/contract-electricity-limits',
    method: 'PUT',
    stepUp: true,
    body: {
      max_quantity_increase_percent: 20,
      max_contract_duration_months: 24,
      lead_time_days: 0,
    },
  },
  {
    name: 'gift code creation',
    path: 'promotions/gift-codes',
    method: 'POST',
    stepUp: true,
    body: { code: 'SPRINT', discountType: 'fixed_irr', discountValue: '1000' },
  },
  {
    name: 'contract template creation',
    path: 'contract-templates',
    method: 'POST',
    stepUp: true,
    body: { name: 'Sprint template' },
  },
  { name: 'job retry', path: `failed-jobs/${jobId}/retry`, method: 'POST', stepUp: true },
  { name: 'job resolution', path: `failed-jobs/${jobId}/resolve`, method: 'POST', stepUp: true },
  {
    name: 'reconciliation resolution',
    path: `reconciliation/items/${exceptionId}/resolve`,
    method: 'POST',
    stepUp: false,
    body: { note: 'Checked against the ledger' },
  },
  {
    name: 'province creation',
    path: 'geography/provinces',
    method: 'POST',
    stepUp: false,
    body: { nameFa: 'تست', nameEn: 'Sprint' },
  },
  {
    name: 'city import',
    path: `geography/provinces/${provinceId}/cities/import`,
    method: 'POST',
    stepUp: false,
    body: {
      cities: [
        { nameFa: 'تست', nameEn: 'Imported Alpha' },
        { nameFa: 'تست', nameEn: 'Imported Beta' },
      ],
    },
  },
  {
    name: 'city creation',
    path: `geography/provinces/${provinceId}/cities`,
    method: 'POST',
    stepUp: false,
    body: { nameFa: 'تست', nameEn: 'Sprint' },
  },
] as const;

function call(action: (typeof actions)[number]) {
  return fetch(`${http.base}/api/admin/${action.path}`, {
    method: action.method,
    headers: {
      Cookie: `barghsa_session=${sessionId}`,
      'X-CSRF-Token': csrf,
      'Content-Type': 'application/json',
    },
    ...(!('body' in action) ? {} : { body: JSON.stringify(action.body) }),
  });
}
async function snapshot() {
  const result: Record<string, unknown> = {};
  for (const table of [
    'app_config',
    'config_version',
    'gift_codes',
    'contract_templates',
    'background_jobs',
    'reconciliation_exceptions',
    'provinces',
    'cities',
  ]) {
    result[table] = (await http.pool.query(`SELECT * FROM ${table} ORDER BY 1`)).rows;
  }
  result.audit = (
    await http.pool.query(
      "SELECT * FROM audit_log WHERE event IN ('config_change','change_recorded','resolution_recorded','job_retry_requested','job_resolved') ORDER BY id"
    )
  ).rows;
  return result;
}
const changes = [
  { name: 'revoked', sql: 'revoked_at=clock_timestamp()', status: 401 },
  { name: 'expired', sql: "expires_at=clock_timestamp()-INTERVAL '1 second'", status: 401 },
  { name: 'changed CSRF', sql: "csrf_token='changed-proof'", status: 403 },
  { name: 'stale step-up', sql: 'step_up_verified_at=NULL', status: 403 },
];
for (const action of actions) {
  for (const change of changes.filter((c) => action.stepUp || c.name !== 'stale step-up')) {
    it(`${action.name} rolls back ${change.name} authority before commit`, async () => {
      const before = await snapshot();
      // Change authority after the guards and transaction writes. This isolates
      // the final authorization check from authentication middleware checks.
      await http.pool
        .query(`CREATE FUNCTION change_sprint_session() RETURNS trigger LANGUAGE plpgsql AS $$
        BEGIN UPDATE sessions SET ${change.sql} WHERE user_id='sprint-admin'; RETURN NEW; END $$;
        CREATE TRIGGER change_sprint_session BEFORE INSERT ON audit_log FOR EACH ROW
        WHEN (NEW.event IN ('config_change','change_recorded','resolution_recorded','job_retry_requested','job_resolved')) EXECUTE FUNCTION change_sprint_session()`);
      try {
        const response = await call(action);
        expect(response.status, await response.text()).toBe(change.status);
        expect(await snapshot()).toEqual(before);
      } finally {
        await http.pool.query(
          'DROP TRIGGER change_sprint_session ON audit_log; DROP FUNCTION change_sprint_session()'
        );
      }
    });
  }
}

for (const action of actions) {
  it(`${action.name} commits with current authority`, async () => {
    if (action.name === 'job resolution')
      await http.pool.query("UPDATE background_jobs SET status='failed' WHERE id=$1", [jobId]);
    const response = await call(action);
    expect(response.status, await response.text()).toBeLessThan(300);
  });
}

it('keeps a referenced city active and does not advance configuration or audit', async () => {
  const cityId = randomUUID();
  const profileId = randomUUID();
  await http.pool.query(
    "INSERT INTO cities(id,province_id,name_fa,name_en) VALUES ($1,$2,'تست','Referenced')",
    [cityId, provinceId]
  );
  await http.pool.query("INSERT INTO profiles(id,user_id) VALUES ($1,'sprint-admin')", [profileId]);
  await http.pool.query(
    "INSERT INTO addresses(profile_id,province_id,city_id,full_address,postal_code) VALUES ($1,$2,$3,'Fixture address','1234567890')",
    [profileId, provinceId, cityId]
  );
  const before = await snapshot();
  const response = await fetch(
    `${http.base}/api/admin/geography/provinces/${provinceId}/cities/${cityId}`,
    { method: 'DELETE', headers: { Cookie: `barghsa_session=${sessionId}`, 'X-CSRF-Token': csrf } }
  );
  expect(response.status, await response.text()).toBe(409);
  expect(await snapshot()).toEqual(before);
  const patch = await fetch(
    `${http.base}/api/admin/geography/provinces/${provinceId}/cities/${cityId}`,
    {
      method: 'PATCH',
      headers: {
        Cookie: `barghsa_session=${sessionId}`,
        'X-CSRF-Token': csrf,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ status: 'inactive' }),
    }
  );
  expect(patch.status, await patch.text()).toBe(409);
  expect(await snapshot()).toEqual(before);
});

it('rolls back the complete city import when a later row conflicts', async () => {
  const before = await snapshot();
  const response = await fetch(
    `${http.base}/api/admin/geography/provinces/${provinceId}/cities/import`,
    {
      method: 'POST',
      headers: {
        Cookie: `barghsa_session=${sessionId}`,
        'X-CSRF-Token': csrf,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        cities: [
          { nameFa: 'تست', nameEn: 'Rolled Back' },
          { nameFa: 'تست', nameEn: 'Imported Alpha' },
        ],
      }),
    }
  );
  expect(response.status, await response.text()).toBe(409);
  expect(await snapshot()).toEqual(before);
});
