import { fetchWithPreauth } from '../test/public-auth.js';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import * as argon2 from 'argon2';
import { startHttpFixture } from '../test/http-fixture.js';

let http: Awaited<ReturnType<typeof startHttpFixture>>;
let sessionCookie: string;
let csrf: string;
const terms = randomUUID();
const password = 'Device-quota-password-123!';
const primary = 'device-owner@example.test';
let device: string;
const deviceKey = (token: string) =>
  `otp:device:${createHash('sha256').update(token).digest('hex')}:3600s`;

beforeEach(async () => {
  // Exercise the application with one connection, including paired issuance.
  vi.stubEnv('DB_POOL_MIN', '1');
  vi.stubEnv('DB_POOL_MAX', '1');
  if (!process.env.TEST_DATABASE_URL) throw new Error('PostgreSQL setup did not run');
  http = await startHttpFixture(process.env.TEST_DATABASE_URL);
  device = randomBytes(32).toString('hex');
  await http.pool.query(
    `INSERT INTO tos_versions(id,version_id,content_fa,content_en,status,is_active,published_at)
     VALUES ($1,'device-v1','قوانین','Terms','published',true,NOW())`,
    [terms]
  );
  await http.pool.query(
    `INSERT INTO users(user_id,username,email,password_hash) VALUES ('device-owner',$1,$1,$2)`,
    [primary, await argon2.hash(password)]
  );
  const session = randomUUID();
  csrf = randomUUID();
  await http.pool.query(
    `INSERT INTO sessions(session_id,user_id,csrf_token,family_id,expires_at,idle_deadline)
     VALUES ($1,'device-owner',$2,$3,NOW()+INTERVAL '1 day',NOW()+INTERVAL '30 minutes')`,
    [session, csrf, randomUUID()]
  );
  sessionCookie = `barghsa_session=${session}`;
}, 40000);

afterEach(async () => {
  await http?.close();
  vi.unstubAllEnvs();
}, 15000);

async function post(path: string, body: unknown, token: string | null = device) {
  const response = await fetchWithPreauth(`${http.base}/api/auth/${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Cookie: [sessionCookie, token && `barghsa_device=${token}`].filter(Boolean).join('; '),
      'X-CSRF-Token': csrf,
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(5000),
  });
  const result = (await response.json()) as {
    challengeId?: string;
    error?: { code: string };
  };
  return { response, result };
}
const register = (username: string, token: string | null = device) =>
  post('register', { username, password, tosVersionId: terms }, token);
async function fill(key: string, count: number) {
  for (let i = 0; i < count; i++)
    await http.pool.query('SELECT count FROM rate_limit_rolling(true,$1,3600000,20,true)', [key]);
}
async function count(key: string) {
  return Number(
    (
      await http.pool.query('SELECT count FROM rate_limit_rolling(true,$1,3600000,NULL,false)', [
        key,
      ])
    ).rows[0].count
  );
}
async function queued() {
  return (await http.pool.query('SELECT count(*)::int AS count FROM auth_delivery_outbox')).rows[0]
    .count;
}
function limited(result: Awaited<ReturnType<typeof post>>) {
  expect(result.response.status, JSON.stringify(result.result) + http.logs()).toBe(429);
  expect(result.result).toMatchObject({ error: { code: 'AUTH:OTP:RATE_LIMITED' } });
  expect(Number(result.response.headers.get('retry-after'))).toBeGreaterThan(0);
}
async function clearMinute(destination: string) {
  await http.pool.query('SELECT rate_limit_rolling_reset(true,$1)', [
    `otp:dest:${destination}:60s`,
  ]);
}

it('issues a private device cookie and reuses only its digest across destinations', async () => {
  const first = await register('device-first@example.test', null);
  expect(first.response.status, http.logs()).toBe(200);
  const cookie = first.response.headers
    .getSetCookie()
    .find((value) => value.startsWith('barghsa_device='));
  expect(cookie).toMatch(/barghsa_device=[a-f0-9]{64};/);
  expect(cookie).toContain('HttpOnly');
  expect(cookie).toContain('Path=/');
  expect(cookie).toContain('SameSite=Lax');
  const token = cookie!.split(';')[0]!.split('=')[1]!;
  const second = await register('device-second@example.test', token);
  expect(second.response.status, http.logs()).toBe(200);
  expect(
    second.response.headers.getSetCookie().some((value) => value.startsWith('barghsa_device='))
  ).toBe(false);
  expect(await count(deviceKey(token))).toBe(2);
  const keys = (
    await http.pool.query("SELECT key FROM rate_limit_windows WHERE key LIKE 'otp:device:%'")
  ).rows;
  expect(keys).toEqual([{ key: deviceKey(token) }]);
  expect(keys[0].key).not.toContain(token);
});

it('serializes the last shared device slot across concurrent registrations', async () => {
  await fill(deviceKey(device), 19);
  const results = await Promise.all([
    register('device-race-a@example.test'),
    register('device-race-b@example.test'),
  ]);
  expect(results.map((r) => r.response.status).sort()).toEqual([200, 429]);
  limited(results.find((r) => r.response.status === 429)!);
  expect(await count(deviceKey(device))).toBe(20);
  expect(await queued()).toBe(1);
  expect(
    (await register('device-race-c@example.test', randomBytes(32).toString('hex'))).response.status
  ).toBe(200);
});

it('reuses an identical registration without consuming another device send', async () => {
  await fill(deviceKey(device), 19);
  const first = await register('device-dedup@example.test');
  const retry = await register('device-dedup@example.test');
  expect(first.response.status).toBe(200);
  expect(retry.response.status, http.logs()).toBe(200);
  expect(retry.result).toEqual(first.result);
  limited(await register('device-dedup-other@example.test'));
  expect(await count(deviceKey(device))).toBe(20);
  expect(await queued()).toBe(1);
});

it('rolls back the device quota when registration delivery cannot be queued', async () => {
  await http.pool
    .query(`CREATE FUNCTION reject_device_delivery() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN RAISE EXCEPTION 'Injected queue failure'; END $$;
    CREATE TRIGGER reject_device_delivery BEFORE INSERT ON auth_delivery_outbox
    FOR EACH ROW EXECUTE FUNCTION reject_device_delivery();`);
  expect((await register('device-rollback@example.test')).response.status).toBe(500);
  expect(await count(deviceKey(device))).toBe(0);
  expect(await queued()).toBe(0);
  await http.pool.query('DROP TRIGGER reject_device_delivery ON auth_delivery_outbox');
  expect((await register('device-rollback@example.test')).response.status).toBe(200);
  expect(await count(deviceKey(device))).toBe(1);
});

for (const flow of ['registration', 'login'] as const) {
  it(`charges ${flow} resends and preserves the old challenge when the device is exhausted`, async () => {
    const destination = flow === 'registration' ? 'device-resend@example.test' : primary;
    const start =
      flow === 'registration'
        ? await register(destination)
        : await post('login', { username: primary, password });
    expect(start.response.status, http.logs()).toBe(200);
    const challengeId = start.result.challengeId;
    expect(challengeId).toBeTruthy();
    await clearMinute(destination);
    const path = flow === 'registration' ? 'register/resend' : 'login/resend';
    const resent = await post(path, { challengeId });
    expect(resent.response.status, http.logs()).toBe(200);
    expect(resent.result.challengeId).toBe(challengeId);
    expect(await count(deviceKey(device))).toBe(2);
    await fill(deviceKey(device), 18);
    await clearMinute(destination);
    const before = (
      await http.pool.query(
        'SELECT otp_hash,expires_at,resend_count FROM otp_challenges WHERE challenge_id=$1',
        [challengeId]
      )
    ).rows[0];
    limited(await post(path, { challengeId }));
    expect(
      (
        await http.pool.query(
          'SELECT otp_hash,expires_at,resend_count FROM otp_challenges WHERE challenge_id=$1',
          [challengeId]
        )
      ).rows[0]
    ).toEqual(before);
    expect(await queued()).toBe(2);
  });
}

for (const [name, path, body] of [
  [
    'login',
    'login',
    { username: primary, password, deviceInfo: { fingerprint: 'body-cannot-bypass-cookie' } },
  ],
  ['known reset', 'forgot-password', { username: primary }],
  ['unknown reset', 'forgot-password', { username: 'unknown-device@example.test' }],
  ['add contact', 'add-contact/send-otp', { contactType: 'mobile', contactValue: '+989121234567' }],
  ['username change', 'change-username/send-otp', { newUsername: 'changed-device@example.test' }],
] as const) {
  it(`applies the same exhausted browser quota to ${name}`, async () => {
    await fill(deviceKey(device), 20);
    limited(await post(path, body));
    expect(await queued()).toBe(0);
  });
}

it('counts both username-change deliveries and rolls back a half-issued pair on one connection', async () => {
  await fill(deviceKey(device), 19);
  limited(await post('change-username/send-otp', { newUsername: 'pair-device@example.test' }));
  expect(await count(deviceKey(device))).toBe(19);
  expect(await queued()).toBe(0);
  expect(
    (await http.pool.query('SELECT count(*)::int AS count FROM otp_challenges')).rows[0].count
  ).toBe(0);
  await http.pool.query('SELECT rate_limit_rolling_reset(true,$1)', [deviceKey(device)]);
  await fill(deviceKey(device), 18);
  const next = await post('change-username/send-otp', { newUsername: 'pair-device@example.test' });
  expect(next.response.status, JSON.stringify(next.result) + http.logs()).toBe(200);
  expect(await count(deviceKey(device))).toBe(20);
  expect(await queued()).toBe(2);
  const challenges = (
    await http.pool.query('SELECT challenge_id,previous_challenge_id FROM otp_challenges')
  ).rows;
  expect(challenges).toHaveLength(2);
  expect(
    challenges.find((row) => row.challenge_id === next.result.challengeId)?.previous_challenge_id
  ).toBe(challenges.find((row) => row.challenge_id !== next.result.challengeId)?.challenge_id);
});
