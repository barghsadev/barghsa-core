import { afterAll, beforeAll, expect, it } from 'vitest';
import { createHash, randomUUID } from 'node:crypto';
import type { Pool } from 'pg';
import * as argon2 from 'argon2';
import { startHttpFixture } from '../test/http-fixture.js';

let fixture: Awaited<ReturnType<typeof startHttpFixture>> | undefined;
let pool: Pool;
let base: string;
const password = 'Http-test-only-password-123!';
const fingerprint = 'd'.repeat(64);

beforeAll(async () => {
  if (!process.env.TEST_DATABASE_URL) throw new Error('PostgreSQL setup did not run');
  fixture = await startHttpFixture(process.env.TEST_DATABASE_URL);
  ({ pool, base } = fixture);
  await pool.query('INSERT INTO users(user_id, username, password_hash) VALUES ($1,$2,$3)', [
    'http-user',
    'http@example.test',
    await argon2.hash(password),
  ]);
  await pool.query(
    "INSERT INTO device_trusts(id,user_id,device_fingerprint,expires_at,ip_address) VALUES ($1,$2,$3,NOW()+INTERVAL '1 day','127.0.0.1')",
    [randomUUID(), 'http-user', createHash('sha256').update(fingerprint).digest('hex')]
  );
}, 40000);

afterAll(async () => {
  await fixture?.close();
}, 15000);

async function login() {
  const response = await fetch(`${base}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: `barghsa_device=${fingerprint}` },
    body: JSON.stringify({ username: 'http@example.test', password, deviceInfo: { fingerprint } }),
  });
  const data = (await response.json()) as {
    requiresOtp: boolean;
    csrfToken: string;
    sessionId: string;
  };
  expect(response.status, JSON.stringify(data) + fixture!.logs()).toBe(200);
  expect(data.requiresOtp).toBe(false);
  const cookies = response.headers.getSetCookie();
  expect(cookies.find((cookie) => cookie.startsWith('barghsa_csrf='))).toContain('Max-Age=86400');
  return {
    cookie: cookies.map((cookie) => cookie.split(';')[0]).join('; '),
    token: data.csrfToken as string,
    sessionId: data.sessionId as string,
  };
}

function adoptRotation(auth: Awaited<ReturnType<typeof login>>, response: Response) {
  const cookies = response.headers.getSetCookie();
  const values = Object.fromEntries(cookies.map((cookie) => cookie.split(';')[0]!.split('=')));
  expect(cookies).toHaveLength(3);
  expect(cookies.find((cookie) => cookie.startsWith('barghsa_session='))).toContain('HttpOnly');
  expect(cookies.find((cookie) => cookie.startsWith('barghsa_refresh='))).toContain('HttpOnly');
  expect(cookies.find((cookie) => cookie.startsWith('barghsa_csrf='))).not.toContain('HttpOnly');
  expect(values.barghsa_session).not.toBe(auth.sessionId);
  expect(values.barghsa_csrf).not.toBe(auth.token);
  auth.cookie = cookies.map((cookie) => cookie.split(';')[0]).join('; ');
  auth.sessionId = values.barghsa_session!;
  auth.token = values.barghsa_csrf!;
}

it('authenticates parsed cookies and rejects unsafe requests before extending or revoking a session', async () => {
  const auth = await login();
  expect(
    (await pool.query('SELECT device_info FROM sessions WHERE session_id=$1', [auth.sessionId]))
      .rows[0].device_info.fingerprint
  ).toBe(createHash('sha256').update(fingerprint).digest('hex'));
  // Legacy sessions may still contain the raw browser token and internal fields.
  // The display endpoint must never expose either, even before those rows expire.
  await pool.query('UPDATE sessions SET device_info=$1::jsonb WHERE session_id=$2', [
    JSON.stringify({
      ip: '192.0.2.1',
      userAgent: 'Fixture browser',
      fingerprint,
      secret: 'private-field',
    }),
    auth.sessionId,
  ]);
  expect((await fetch(`${base}/api/auth/sessions`)).status).toBe(401);
  const listed = await fetch(`${base}/api/auth/sessions`, { headers: { Cookie: auth.cookie } });
  expect(listed.status).toBe(200);
  const display = await listed.text();
  expect(display).not.toContain(fingerprint);
  expect(display).not.toContain('private-field');
  expect(
    JSON.parse(display).find((row: { sessionId: string }) => row.sessionId === auth.sessionId)
      .deviceInfo
  ).toEqual({ ip: '192.0.2.1', userAgent: 'Fixture browser' });
  const before = (
    await pool!.query('SELECT idle_deadline FROM sessions WHERE session_id=$1', [auth.sessionId])
  ).rows[0];
  for (const token of [undefined, 'wrong-token']) {
    const headers: Record<string, string> = { Cookie: auth.cookie };
    if (token) headers['X-CSRF-Token'] = token;
    expect((await fetch(`${base}/api/auth/logout`, { method: 'POST', headers })).status).toBe(403);
    expect(
      (await fetch(`${base}/api/auth/sessions/${randomUUID()}`, { method: 'DELETE', headers }))
        .status
    ).toBe(403);
  }
  const after = (
    await pool!.query('SELECT idle_deadline, revoked_at FROM sessions WHERE session_id=$1', [
      auth.sessionId,
    ])
  ).rows[0];
  expect(after).toEqual({ ...before, revoked_at: null });
  expect(
    (
      await fetch(`${base}/api/auth/step-up`, {
        method: 'POST',
        headers: { Cookie: auth.cookie, 'Content-Type': 'application/json' },
        body: JSON.stringify({ password }),
      })
    ).status
  ).toBe(403);
  const old = { ...auth };
  const verified = await fetch(`${base}/api/auth/step-up`, {
    method: 'POST',
    headers: {
      Cookie: auth.cookie,
      'Content-Type': 'application/json',
      'X-CSRF-Token': auth.token,
    },
    body: JSON.stringify({ password }),
  });
  expect(verified.status).toBe(200);
  adoptRotation(auth, verified);
  expect(
    (await fetch(`${base}/api/auth/sessions`, { headers: { Cookie: old.cookie } })).status
  ).toBe(401);
  expect(
    (
      await fetch(`${base}/api/auth/logout`, {
        method: 'POST',
        headers: { Cookie: auth.cookie, 'X-CSRF-Token': old.token },
      })
    ).status
  ).toBe(403);
  const otherSession = await login();
  expect(otherSession.token).not.toBe(auth.token);
  expect(
    (
      await fetch(`${base}/api/auth/step-up`, {
        method: 'POST',
        headers: {
          Cookie: otherSession.cookie,
          'Content-Type': 'application/json',
          'X-CSRF-Token': auth.token,
        },
        body: JSON.stringify({ password }),
      })
    ).status
  ).toBe(403);
  expect(
    (
      await fetch(`${base}/api/auth/sessions/${randomUUID()}`, {
        method: 'DELETE',
        headers: { Cookie: auth.cookie, 'X-CSRF-Token': auth.token },
      })
    ).status
  ).toBe(404);
  expect(
    (
      await fetch(`${base}/api/auth/logout`, {
        method: 'POST',
        headers: { Cookie: auth.cookie, 'X-CSRF-Token': auth.token },
      })
    ).status
  ).toBe(200);
  expect(
    (await fetch(`${base}/api/auth/sessions`, { headers: { Cookie: auth.cookie } })).status
  ).toBe(401);
}, 15000);

it('requires CSRF for refresh, rejects idle expiry, and retains refresh reuse revocation', async () => {
  const auth = await login();
  for (const token of [undefined, 'wrong-token']) {
    const headers: Record<string, string> = { Cookie: auth.cookie };
    if (token) headers['X-CSRF-Token'] = token;
    expect((await fetch(`${base}/api/auth/refresh`, { method: 'POST', headers })).status).toBe(403);
  }
  expect(
    (
      await pool!.query('SELECT consumed_at FROM refresh_tokens WHERE session_id=$1', [
        auth.sessionId,
      ])
    ).rows
  ).toEqual([{ consumed_at: null }]);
  await pool!.query(
    "UPDATE sessions SET idle_deadline=NOW()-INTERVAL '1 minute' WHERE session_id=$1",
    [auth.sessionId]
  );
  expect(
    (await fetch(`${base}/api/auth/sessions`, { headers: { Cookie: auth.cookie } })).status
  ).toBe(401);
  expect(
    (
      await fetch(`${base}/api/auth/refresh`, {
        method: 'POST',
        headers: { Cookie: auth.cookie, 'X-CSRF-Token': auth.token },
      })
    ).status
  ).toBe(403);
  expect(
    (
      await pool.query('SELECT consumed_at FROM refresh_tokens WHERE session_id=$1', [
        auth.sessionId,
      ])
    ).rows
  ).toEqual([{ consumed_at: null }]);
  const fresh = await login();
  const headers = { Cookie: fresh.cookie, 'X-CSRF-Token': fresh.token };
  const refreshed = await fetch(`${base}/api/auth/refresh`, { method: 'POST', headers });
  expect(refreshed.status, await refreshed.text()).toBe(200);
  expect(
    (await fetch(`${base}/api/auth/sessions`, { headers: { Cookie: fresh.cookie } })).status
  ).toBe(200);
  expect((await fetch(`${base}/api/auth/refresh`, { method: 'POST', headers })).status).toBe(401);
  expect(
    (await pool!.query('SELECT revoked_at FROM sessions WHERE session_id=$1', [fresh.sessionId]))
      .rows[0].revoked_at
  ).not.toBeNull();
}, 15000);

it('requires recent step-up to revoke a session and retains the ownership boundary', async () => {
  const auth = await login();
  const target = await login();
  const headers = {
    Cookie: auth.cookie,
    'Content-Type': 'application/json',
    'X-CSRF-Token': auth.token,
  };
  const revoke = () =>
    fetch(`${base}/api/auth/sessions/${target.sessionId}`, { method: 'DELETE', headers });
  for (const verifiedAt of [null, new Date(Date.now() - 16 * 60_000)]) {
    await pool.query('UPDATE sessions SET step_up_verified_at=$1 WHERE session_id=$2', [
      verifiedAt,
      auth.sessionId,
    ]);
    const response = await revoke();
    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ error: { code: 'AUTHZ:STEP_UP_REQUIRED' } });
    expect(
      (await pool.query('SELECT revoked_at FROM sessions WHERE session_id=$1', [target.sessionId]))
        .rows[0].revoked_at
    ).toBeNull();
  }
  const wrong = await fetch(`${base}/api/auth/step-up`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ password: 'wrong-password' }),
  });
  expect(wrong.ok).toBe(false);
  expect((await revoke()).status).toBe(403);
  const verified = await fetch(`${base}/api/auth/step-up`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ password }),
  });
  expect(verified.status).toBe(200);
  adoptRotation(auth, verified);
  headers.Cookie = auth.cookie;
  headers['X-CSRF-Token'] = auth.token;
  const acknowledgement = (await verified.json()) as { stepUpVerifiedAt: string };
  const audit = (
    await pool.query(
      "SELECT metadata,correlation_id,created_at FROM audit_log WHERE user_id='http-user' AND event='step_up_verified' ORDER BY created_at DESC LIMIT 1"
    )
  ).rows[0];
  expect(audit).toBeDefined();
  expect(JSON.parse(audit.metadata)).toMatchObject({
    stepUpVerified: true,
    verifiedAt: acknowledgement.stepUpVerifiedAt,
  });
  expect(audit.correlation_id).toBe(verified.headers.get('x-correlation-id'));
  expect(audit.created_at.toISOString()).toBe(acknowledgement.stepUpVerifiedAt);
  const outsider = randomUUID();
  await pool.query('INSERT INTO users(user_id,username,password_hash) VALUES ($1,$2,$3)', [
    outsider,
    `${outsider}@example.test`,
    'not-used',
  ]);
  await pool.query('UPDATE sessions SET user_id=$1 WHERE session_id=$2', [
    outsider,
    target.sessionId,
  ]);
  expect((await revoke()).status).toBe(404);
  expect(
    (await pool.query('SELECT revoked_at FROM sessions WHERE session_id=$1', [target.sessionId]))
      .rows[0].revoked_at
  ).toBeNull();
  await pool.query('UPDATE sessions SET user_id=$1 WHERE session_id=$2', [
    'http-user',
    target.sessionId,
  ]);
  expect((await revoke()).status).toBe(200);
  expect(
    (await fetch(`${base}/api/auth/sessions`, { headers: { Cookie: target.cookie } })).status
  ).toBe(401);
  expect(
    (
      await pool.query('SELECT consumed_at FROM refresh_tokens WHERE session_id=$1', [
        target.sessionId,
      ])
    ).rows.every((row) => row.consumed_at !== null)
  ).toBe(true);
  expect(
    (await fetch(`${base}/api/auth/sessions`, { headers: { Cookie: auth.cookie } })).status
  ).toBe(200);
}, 15000);

it('rejects form-encoded public authentication before creating a session', async () => {
  const before = Number(
    (await pool.query("SELECT count(*) FROM sessions WHERE user_id='http-user'")).rows[0].count
  );
  const response = await fetch(`${base}/api/auth/login`, {
    method: 'POST',
    headers: { Cookie: `barghsa_device=${fingerprint}`, Origin: 'https://untrusted.example' },
    body: new URLSearchParams({ username: 'http@example.test', password }),
  });
  expect(response.status).toBe(403);
  expect(await response.json()).toMatchObject({ error: { code: 'AUTHZ:CSRF_TOKEN_INVALID' } });
  expect(response.headers.getSetCookie()).toHaveLength(0);
  expect(
    Number(
      (await pool.query("SELECT count(*) FROM sessions WHERE user_id='http-user'")).rows[0].count
    )
  ).toBe(before);
});

it.each([
  'register',
  'login/verify',
  'login/resend',
  'force-change-password',
  'activate-staff',
  'forgot-password',
  'reset-password',
  'register/verify',
  'register/resend',
])('rejects form submissions to public auth /%s before processing credentials', async (path) => {
  const response = await fetch(`${base}/api/auth/${path}`, {
    method: 'POST',
    body: new URLSearchParams({}),
  });
  expect(response.status).toBe(403);
  expect(await response.json()).toMatchObject({ error: { code: 'AUTHZ:CSRF_TOKEN_INVALID' } });
  expect(response.headers.getSetCookie()).toHaveLength(0);
});

it('does not authorize cross-origin browser JSON authentication requests', async () => {
  const response = await fetch(`${base}/api/auth/login`, {
    method: 'OPTIONS',
    headers: {
      Origin: 'https://untrusted.example',
      'Access-Control-Request-Method': 'POST',
      'Access-Control-Request-Headers': 'content-type',
    },
  });
  expect(response.headers.get('access-control-allow-origin')).toBeNull();
  expect(response.headers.get('access-control-allow-credentials')).toBeNull();
});

it('invalidates old sessions and refresh tokens atomically on a forced password change', async () => {
  const auth = await login();
  const passwordChangeToken = randomUUID();
  await pool.query(
    "UPDATE users SET must_change_password=true, password_change_token=$1, password_change_token_expires_at=NOW()+INTERVAL '5 minutes' WHERE user_id='http-user'",
    [passwordChangeToken]
  );
  await pool.query(
    'INSERT INTO password_history(id,user_id,password_hash,version) VALUES ($1,$2,$3,1)',
    [randomUUID(), 'http-user', await argon2.hash('Older-test-password-123!')]
  );
  const response = await fetch(`${base}/api/auth/force-change-password`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ passwordChangeToken, newPassword: 'Changed-test-password-456!' }),
  });
  expect(response.status, await response.text()).toBe(200);
  expect(
    (await fetch(`${base}/api/auth/sessions`, { headers: { Cookie: auth.cookie } })).status
  ).toBe(401);
  expect(
    (
      await fetch(`${base}/api/auth/refresh`, {
        method: 'POST',
        headers: { Cookie: auth.cookie, 'X-CSRF-Token': auth.token },
      })
    ).status
  ).toBe(403);
  expect(
    (
      await pool.query(
        "SELECT count(*)::int AS active FROM sessions WHERE user_id='http-user' AND revoked_at IS NULL"
      )
    ).rows[0].active
  ).toBe(0);
  expect(
    (
      await pool.query(
        "SELECT count(*)::int AS active FROM refresh_tokens WHERE user_id='http-user' AND consumed_at IS NULL"
      )
    ).rows[0].active
  ).toBe(0);
  expect(
    (
      await pool.query(
        "SELECT version FROM password_history WHERE user_id='http-user' ORDER BY version"
      )
    ).rows
  ).toEqual([{ version: 1 }, { version: 2 }]);
}, 15000);
