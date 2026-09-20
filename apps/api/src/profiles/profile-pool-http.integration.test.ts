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

for (const action of ['save', 'complete', 'edit'] as const) {
  it(`finishes ${action} with one available database connection and returns committed state`, async () => {
    const data = {
      firstName: 'Changed',
      lastName: 'Owner',
      nationalId: '1234567891',
      provinceId,
      cityId,
      fullAddress: 'Street',
      postalCode: '1234567890',
    };
    if (action === 'complete') {
      await http.pool.query("UPDATE profiles SET national_id='1234567891' WHERE id=$1", [
        profileId,
      ]);
      await http.pool.query(
        "INSERT INTO addresses(profile_id,province_id,city_id,full_address,postal_code,main_address) VALUES ($1,$2,$3,'Street','1234567890',true)",
        [profileId, provinceId, cityId]
      );
    }
    const response = await fetch(
      `${http.base}${action === 'edit' ? `/api/profiles/${profileId}` : action === 'save' ? `/api/onboarding/individual/${profileId}` : `/api/onboarding/complete/${profileId}`}`,
      {
        method: action === 'edit' ? 'PUT' : 'POST',
        headers,
        signal: AbortSignal.timeout(2500),
        ...(action === 'complete'
          ? {}
          : { body: JSON.stringify(action === 'edit' ? { firstName: 'Changed' } : data) }),
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
