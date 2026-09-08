import { afterAll, beforeAll, beforeEach, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import * as argon2 from 'argon2';
import { rateLimitKey } from '@barghsa/shared/rate-limit';
import { startHttpFixture } from '../test/http-fixture.js';

let http: Awaited<ReturnType<typeof startHttpFixture>>;
const password = 'Preauth-fixture-password-123!';
const device = 'd'.repeat(64);
const routes = [
  'login',
  'login/verify',
  'login/resend',
  'register',
  'register/verify',
  'register/resend',
  'forgot-password',
  'reset-password',
  'reset-password/verify',
  'force-change-password',
  'activate-staff',
];

beforeAll(async () => {
  http = await startHttpFixture(process.env.TEST_DATABASE_URL!);
  await http.pool.query(
    "INSERT INTO users(user_id,username,password_hash) VALUES ('preauth-user','preauth@example.test',$1)",
    [await argon2.hash(password)]
  );
  await http.pool.query(
    `INSERT INTO device_trusts(id,user_id,device_fingerprint,expires_at,ip_address)
     VALUES (gen_random_uuid(),'preauth-user',$1,NOW()+INTERVAL '1 day','127.0.0.1')`,
    [createHash('sha256').update(device).digest('hex')]
  );
}, 40000);
beforeEach(async () => {
  await http.pool.query(
    'TRUNCATE preauth_sessions,rate_limit_windows,security_rate_limit_counters'
  );
});
afterAll(async () => http?.close());

async function bootstrap(cookie = '') {
  const response = await fetch(`${http.base}/api/auth/csrf`, { headers: { Cookie: cookie } });
  expect(response.status, await response.clone().text()).toBe(200);
  const body = (await response.json()) as {
    csrfToken: string;
    requiresOtp: boolean;
    sessionId: string;
    refreshToken: string;
  };
  return {
    response,
    token: body.csrfToken as string,
    cookie: response.headers.getSetCookie()[0]?.split(';')[0] ?? cookie,
  };
}
function post(route: string, cookie = '', token?: string, body: unknown = {}) {
  return fetch(`${http.base}/api/auth/${route}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Cookie: cookie,
      ...(token ? { 'X-CSRF-Token': token } : {}),
    },
    body: JSON.stringify(body),
  });
}

it.each(routes)('rejects tokenless JSON at %s before validation or side effects', async (route) => {
  const response = await post(route);
  expect(response.status).toBe(403);
  expect(((await response.json()) as { error: unknown }).error).toMatchObject({
    code: 'AUTHZ:CSRF_TOKEN_INVALID',
    correlationId: expect.any(String),
  });
  expect(
    (await http.pool.query('SELECT count(*)::int AS count FROM otp_challenges')).rows[0].count
  ).toBe(0);
});

it('issues opaque HttpOnly browser cookies, reuses live tokens and prevents caching', async () => {
  const first = await bootstrap();
  expect(first.token).toMatch(/^[a-f0-9]{64}$/);
  expect(first.response.headers.get('cache-control')).toContain('no-store');
  expect(first.response.headers.get('vary')).toContain('Cookie');
  const cookie = first.response.headers.getSetCookie()[0]!;
  expect(cookie).toContain('HttpOnly');
  expect(cookie).toContain('SameSite=Strict');
  expect(cookie).toContain('Max-Age=1800');
  expect(cookie).not.toContain(first.token);
  expect((await bootstrap(first.cookie)).token).toBe(first.token);
  expect(
    (await http.pool.query('SELECT count(*)::int AS count FROM preauth_sessions')).rows[0].count
  ).toBe(1);
});

it('rejects missing cookies and cross-browser tokens without consuming valid challenges', async () => {
  const first = await bootstrap();
  const second = await bootstrap();
  expect((await post('login', '', first.token)).status).toBe(403);
  expect((await post('login', first.cookie, second.token)).status).toBe(403);
  expect((await post('login', first.cookie, first.token)).status).toBe(401);
  expect((await post('login', first.cookie, first.token)).status).toBe(403);
});

it('rejects expired tokens and cleans expired rows when issuing a replacement', async () => {
  const old = await bootstrap();
  await http.pool.query(
    "UPDATE preauth_sessions SET created_at=NOW()-INTERVAL '1 hour', expires_at=NOW()-INTERVAL '1 minute'"
  );
  expect((await post('login', old.cookie, old.token)).status).toBe(403);
  expect((await bootstrap(old.cookie)).token).not.toBe(old.token);
  expect(
    (await http.pool.query('SELECT count(*)::int AS count FROM preauth_sessions')).rows[0].count
  ).toBe(1);
});

it('allows only one concurrent use, with no authenticated session promotion', async () => {
  const auth = await bootstrap();
  const results = await Promise.all([
    post('login', auth.cookie, auth.token),
    post('login', auth.cookie, auth.token),
  ]);
  expect(results.map((r) => r.status).sort()).toEqual([401, 403]);
});

it('replaces anonymous CSRF with the authenticated token and never logs credentials', async () => {
  const anonymous = await bootstrap();
  const response = await post(
    'login',
    `${anonymous.cookie}; barghsa_device=${device}`,
    anonymous.token,
    { username: 'preauth@example.test', password }
  );
  expect(response.status, await response.clone().text()).toBe(200);
  const body = (await response.json()) as {
    csrfToken: string;
    requiresOtp: boolean;
    sessionId: string;
    refreshToken: string;
  };
  expect(body.requiresOtp).toBe(false);
  expect(body.csrfToken).not.toBe(anonymous.token);
  const sessionCookie = response.headers
    .getSetCookie()
    .find(
      (value) => value.startsWith('barghsa_session=') && !value.startsWith('barghsa_session=;')
    )!
    .split(';')[0]!;
  expect((await bootstrap(sessionCookie)).token).toBe(body.csrfToken);
  expect((await post('login', sessionCookie, anonymous.token)).status).toBe(403);
  expect((await post('login', anonymous.cookie, anonymous.token)).status).toBe(403);
  expect((await post('logout', sessionCookie, body.csrfToken)).status).toBe(200);
  const log = http.logs();
  for (const token of [
    body.sessionId,
    body.csrfToken,
    body.refreshToken,
    anonymous.token,
    password,
  ]) {
    if (typeof token === 'string') expect(log).not.toContain(token);
  }
});

it('limits new anonymous sessions and returns retry timing', async () => {
  await http.pool.query(
    'INSERT INTO security_rate_limit_counters(key,window_start,window_ms,count) VALUES ($1,$2,60000,60)',
    [rateLimitKey('preauth:ip', '127.0.0.1'), Math.floor(Date.now() / 60000) * 60000]
  );
  const response = await fetch(`${http.base}/api/auth/csrf`);
  expect(response.status).toBe(429);
  expect(Number(response.headers.get('retry-after'))).toBeGreaterThan(0);
  expect(
    (await http.pool.query('SELECT count(*)::int AS count FROM preauth_sessions')).rows[0].count
  ).toBe(0);
});

it('does not grant cross-origin credentialed access to bootstrap', async () => {
  const response = await fetch(`${http.base}/api/auth/csrf`, {
    method: 'OPTIONS',
    headers: { Origin: 'https://attacker.example', 'Access-Control-Request-Method': 'GET' },
  });
  expect(response.headers.get('access-control-allow-origin')).toBeNull();
  expect(response.headers.get('access-control-allow-credentials')).toBeNull();
});
