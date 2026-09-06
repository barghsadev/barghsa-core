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
    "INSERT INTO device_trusts(id,user_id,device_fingerprint,expires_at) VALUES ($1,$2,$3,NOW()+INTERVAL '1 day')",
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

it('authenticates parsed cookies and rejects unsafe requests before extending or revoking a session', async () => {
  const auth = await login();
  expect((await fetch(`${base}/api/auth/sessions`)).status).toBe(401);
  expect(
    (await fetch(`${base}/api/auth/sessions`, { headers: { Cookie: auth.cookie } })).status
  ).toBe(200);
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
  expect(
    (
      await fetch(`${base}/api/auth/step-up`, {
        method: 'POST',
        headers: {
          Cookie: auth.cookie,
          'Content-Type': 'application/json',
          'X-CSRF-Token': auth.token,
        },
        body: JSON.stringify({ password }),
      })
    ).status
  ).toBe(200);
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
