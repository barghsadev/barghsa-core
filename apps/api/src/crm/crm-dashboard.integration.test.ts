import { afterAll, beforeAll, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { startHttpFixture } from '../test/http-fixture.js';

let http: Awaited<ReturnType<typeof startHttpFixture>>;
let cookie: string;
let staffCookie: string;
const ids = Array.from(
  { length: 7 },
  (_, n) => '11111111-1111-4111-8111-' + String(n).padStart(12, '0')
);
beforeAll(async () => {
  http = await startHttpFixture(process.env.TEST_DATABASE_URL!);
  for (const who of ['admin', 'staff']) {
    await http.pool.query(
      "INSERT INTO users(user_id,username,password_hash,is_admin) VALUES ($1,$1,'fixture',$2)",
      [who, who === 'admin']
    );
    const session = randomUUID();
    await http.pool.query(
      "INSERT INTO sessions(session_id,user_id,csrf_token,family_id,expires_at,idle_deadline) VALUES ($1,$2,$3,$4,NOW()+INTERVAL '1 day',NOW()+INTERVAL '30 minutes')",
      [session, who, randomUUID(), randomUUID()]
    );
    if (who === 'admin') cookie = 'barghsa_session=' + session;
    else staffCookie = 'barghsa_session=' + session;
  }
  for (const [n, id] of ids.entries()) {
    await http.pool.query(
      "INSERT INTO profiles(id,user_id,profile_type,status,first_name,last_name,created_at) VALUES ($1,'staff',$2,'PENDING_VERIFICATION','Sara','Example','2026-08-01T12:00:00.123456Z')",
      [id, n === 6 ? 'LEGAL' : 'INDIVIDUAL']
    );
  }
  await http.pool.query(
    "INSERT INTO legal_profiles(id,legal_name,national_identifier,registration_number,representative_title,representative_relationship) VALUES ($1,'Solar Co','fixture-national','fixture-registration','Director','Owner')",
    [ids[6]]
  );
  for (const [status, archived] of [
    ['PENDING_VERIFICATION', true],
    ['VERIFIED', false],
    ['ACTIVE', false],
  ] as const)
    await http.pool.query('INSERT INTO profiles(id,user_id,status,archived) VALUES ($1,$2,$3,$4)', [
      randomUUID(),
      'staff',
      status,
      archived,
    ]);
}, 40000);
afterAll(async () => {
  await http?.close();
});
async function setting(key: string, value: unknown) {
  await http.pool.query(
    'INSERT INTO app_config(key,value,version) VALUES ($1,$2::jsonb,1) ON CONFLICT(key) DO UPDATE SET value=EXCLUDED.value,version=app_config.version+1',
    [key, JSON.stringify(value)]
  );
}
const get = (auth = cookie) =>
  fetch(http.base + '/api/crm/dashboard/pending-verification', { headers: { Cookie: auth } });
it('requires current crm:verify permission even when verification is disabled', async () => {
  await setting('profile_verification_mode', 'DISABLED');
  expect((await get('')).status).toBe(401);
  expect((await get(staffCookie)).status).toBe(403);
  await http.pool.query(
    "INSERT INTO staff_roles(role_id,name,description,permissions) VALUES ('dashboard-reader','Dashboard reader','fixture','[\"crm:read\"]')"
  );
  await http.pool.query(
    "INSERT INTO user_roles(user_id,role_id) VALUES ('staff','dashboard-reader')"
  );
  expect((await get(staffCookie)).status).toBe(403);
  await http.pool.query(
    "UPDATE staff_roles SET permissions='[\"crm:verify\"]' WHERE role_id='dashboard-reader'"
  );
  expect((await get(staffCookie)).status).toBe(200);
  await http.pool.query("UPDATE staff_roles SET permissions='[]' WHERE role_id='dashboard-reader'");
  expect((await get(staffCookie)).status).toBe(403);
});
it('returns no pending identities or count when verification is disabled', async () => {
  await setting('profile_verification_mode', 'DISABLED');
  await setting('verification.required', true);
  const response = await get();
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ enabled: false, count: 0, profiles: [] });
});
it.each(['MANUAL', 'API'])(
  'returns one count snapshot and the latest five entries for %s mode',
  async (mode) => {
    await setting('profile_verification_mode', mode);
    const response = await get();
    expect(response.status, http.logs()).toBe(200);
    const data = (await response.json()) as {
      enabled: boolean;
      count: number;
      profiles: { id: string; createdAt: string; legalName: string | null }[];
    };
    expect(data).toMatchObject({ enabled: true, count: 7 });
    expect(data.profiles.map((p) => p.id)).toEqual([...ids].reverse().slice(0, 5));
    expect(data.profiles.every((p) => p.createdAt === '2026-08-01T12:00:00.123456Z')).toBe(true);
    expect(data.profiles[0]?.legalName).toBe('Solar Co');
  }
);
it('uses legacy required settings only when explicit mode is absent, and fails safe for invalid modes', async () => {
  await http.pool.query("DELETE FROM app_config WHERE key='profile_verification_mode'");
  for (const required of [false, true]) {
    await setting('verification.required', required);
    expect(await (await get()).json()).toMatchObject({
      enabled: required,
      count: required ? 7 : 0,
    });
  }
  await setting('verification.required', false);
  await setting('profile_verification_mode', 'INVALID');
  expect(await (await get()).json()).toMatchObject({ enabled: true, count: 7 });
});
it('returns an empty enabled widget when no pending profiles remain', async () => {
  await setting('profile_verification_mode', 'MANUAL');
  await http.pool.query("UPDATE profiles SET status='ACTIVE' WHERE status='PENDING_VERIFICATION'");
  expect(await (await get()).json()).toEqual({ enabled: true, count: 0, profiles: [] });
});
