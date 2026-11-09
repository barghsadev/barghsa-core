import { createHash, randomUUID } from 'node:crypto';
import { hash } from 'argon2';
import { expect, it, vi } from 'vitest';
import { startHttpFixture } from '../test/http-fixture.js';
import { authCookieValue, fetchWithPreauth } from '../test/public-auth.js';
import { sessionReference } from './session-reference.js';

it('applies configured idle and absolute lifetimes when signing in', async () => {
  if (!process.env.TEST_DATABASE_URL) throw new Error('PostgreSQL setup did not run');
  vi.stubEnv('SESSION_IDLE_TIMEOUT_MINUTES', '5');
  vi.stubEnv('SESSION_ABSOLUTE_TIMEOUT_HOURS', '2');
  let fixture: Awaited<ReturnType<typeof startHttpFixture>> | undefined;

  try {
    fixture = await startHttpFixture(process.env.TEST_DATABASE_URL);
    const password = 'Synthetic session lifetime fixture';
    const userId = 'session-lifetime-fixture';
    const username = 'lifetime@example.test';
    const fingerprint = 'd'.repeat(64);
    await fixture.pool.query('INSERT INTO users(user_id,username,password_hash) VALUES($1,$2,$3)', [
      userId,
      username,
      await hash(password),
    ]);
    await fixture.pool.query(
      `INSERT INTO device_trusts(id,user_id,device_fingerprint,expires_at,ip_address)
       VALUES($1,$2,$3,NOW()+INTERVAL '1 day','127.0.0.1')`,
      [randomUUID(), userId, createHash('sha256').update(fingerprint).digest('hex')]
    );
    const response = await fetchWithPreauth(`${fixture.base}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: `barghsa_device=${fingerprint}` },
      body: JSON.stringify({ username, password, deviceInfo: { fingerprint } }),
    });
    const result = (await response.json()) as { requiresOtp: boolean; sessionId: string };
    expect(response.status, JSON.stringify(result) + fixture.logs()).toBe(200);
    expect(result.requiresOtp).toBe(false);
    const cookies = response.headers.getSetCookie();
    const sessionId = authCookieValue(response, 'barghsa_session');
    expect(result.sessionId).toBe(sessionReference(sessionId));
    expect(cookies.find((cookie) => cookie.startsWith('barghsa_csrf='))).toContain('Max-Age=7200');
    const session = await fixture.pool.query(
      `SELECT EXTRACT(EPOCH FROM expires_at-created_at)::int AS absolute_seconds,
              EXTRACT(EPOCH FROM idle_deadline-created_at)::int AS idle_seconds
       FROM sessions WHERE session_id=$1`,
      [sessionId]
    );
    expect(session.rows).toEqual([{ absolute_seconds: 7200, idle_seconds: 300 }]);
  } finally {
    vi.unstubAllEnvs();
    await fixture?.close();
  }
}, 40000);
