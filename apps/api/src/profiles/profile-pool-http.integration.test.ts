import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { startHttpFixture } from '../test/http-fixture.js';
let http: Awaited<ReturnType<typeof startHttpFixture>>;
let profileId: string, provinceId: string, cityId: string;
let headers: Record<string, string>;
beforeEach(async () => {
  vi.stubEnv('DB_POOL_MAX', '1');
  try {
    http = await startHttpFixture(process.env.TEST_DATABASE_URL!);
  } finally {
    vi.unstubAllEnvs();
  }
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

const individualInput = () => ({
  firstName: 'Changed',
  lastName: 'Owner',
  nationalId: '1234567891',
  provinceId,
  cityId,
  fullAddress: 'Street',
  postalCode: '1234567890',
});
async function prepareCompletion() {
  await http.pool.query("UPDATE profiles SET national_id='1234567891' WHERE id=$1", [profileId]);
  await http.pool.query(
    "INSERT INTO addresses(profile_id,province_id,city_id,full_address,postal_code,main_address) VALUES ($1,$2,$3,'Street','1234567890',true)",
    [profileId, provinceId, cityId]
  );
}

for (const action of ['save', 'complete', 'edit'] as const) {
  it(`finishes ${action} with one available database connection and returns committed state`, async () => {
    if (action === 'complete') await prepareCompletion();
    const response = await fetch(
      `${http.base}${action === 'edit' ? `/api/profiles/${profileId}` : action === 'save' ? `/api/onboarding/individual/${profileId}` : `/api/onboarding/complete/${profileId}`}`,
      {
        method: action === 'edit' ? 'PUT' : 'POST',
        headers,
        signal: AbortSignal.timeout(2500),
        ...(action === 'complete'
          ? {}
          : {
              body: JSON.stringify(
                action === 'edit' ? { firstName: 'Changed' } : individualInput()
              ),
            }),
      }
    );
    expect(response.status, http.logs()).toBe(200);
    const result = (await response.json()) as { status: string; firstName?: string };
    const row = (
      await http.pool.query('SELECT status,first_name FROM profiles WHERE id=$1', [profileId])
    ).rows[0];
    expect(result).toMatchObject({ status: row.status });
    expect(row.status).toBe(action === 'edit' ? 'DRAFT' : 'ACTIVE');
    if (action !== 'complete') expect(row.first_name).toBe('Changed');
    const event =
      action === 'save'
        ? 'individual_profile_saved'
        : action === 'complete'
          ? 'profile_onboarding_completed'
          : 'profile_self_updated';
    expect(
      (await http.pool.query('SELECT id FROM audit_log WHERE event=$1', [event])).rows
    ).toHaveLength(1);
  });
}

it.each([
  ['start', 'profile_draft_created'],
  ['save', 'individual_profile_saved'],
  ['complete', 'profile_onboarding_completed'],
])('rolls back legacy onboarding %s if the session expires during audit', async (action, event) => {
  if (action === 'complete') await prepareCompletion();
  const snapshot = async () => {
    const { rows } = await http.pool.query(
      `SELECT (SELECT jsonb_agg(to_jsonb(p) ORDER BY p.id) FROM profiles p) AS profiles,
              (SELECT jsonb_agg(to_jsonb(a) ORDER BY a.id) FROM addresses a) AS addresses,
              (SELECT count(*)::int FROM audit_log) AS audits`
    );
    return rows[0];
  };
  const before = await snapshot();
  await http.pool.query(`
    CREATE SEQUENCE legacy_onboarding_audit_calls;
    CREATE FUNCTION expire_legacy_onboarding_session() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN
      IF NEW.event='${event}' THEN
        PERFORM nextval('legacy_onboarding_audit_calls');
        UPDATE sessions SET idle_deadline=clock_timestamp()-INTERVAL '1 second'
        WHERE user_id='profile-owner';
      END IF;
      RETURN NEW;
    END $$;
    CREATE TRIGGER expire_legacy_onboarding_session BEFORE INSERT ON audit_log
      FOR EACH ROW EXECUTE FUNCTION expire_legacy_onboarding_session()
  `);
  const path =
    action === 'start'
      ? 'start'
      : action === 'save'
        ? `individual/${profileId}`
        : `complete/${profileId}`;
  const body =
    action === 'start' ? { profileType: 'INDIVIDUAL' } : action === 'save' ? individualInput() : {};
  const response = await fetch(`${http.base}/api/onboarding/${path}`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });
  expect(
    (await http.pool.query('SELECT is_called FROM legacy_onboarding_audit_calls')).rows[0].is_called
  ).toBe(true);
  expect(response.status, await response.clone().text()).toBe(401);
  expect(await snapshot()).toEqual(before);
});
