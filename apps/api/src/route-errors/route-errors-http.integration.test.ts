import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { startHttpFixture } from '../test/http-fixture.js';

let fixture: Awaited<ReturnType<typeof startHttpFixture>>;
const sessionId = randomUUID();
const csrf = randomUUID();
const body = { code: 'CHUNK_LOAD_FAILED', reference: randomUUID() };

beforeAll(async () => {
  vi.stubEnv('ROUTE_ERROR_SENTRY_DSN', '');
  fixture = await startHttpFixture(process.env.TEST_DATABASE_URL!);
  await fixture.pool.query(
    "INSERT INTO users(user_id,username,password_hash) VALUES ('route-reporter','route-reporter@example.test','fixture-only')"
  );
  await fixture.pool.query(
    "INSERT INTO sessions(session_id,user_id,csrf_token,family_id,expires_at,idle_deadline) VALUES ($1,'route-reporter',$2,$3,NOW()+INTERVAL '1 day',NOW()+INTERVAL '1 hour')",
    [sessionId, csrf, randomUUID()]
  );
}, 30000);

afterAll(async () => {
  await fixture?.close();
  vi.unstubAllEnvs();
});

function report(payload: unknown = body, headers: Record<string, string> = {}) {
  return fetch(fixture.base + '/api/route-errors', {
    method: 'POST',
    headers: {
      origin: 'https://app.example.test',
      'sec-fetch-site': 'same-origin',
      'content-type': 'application/json',
      ...headers,
    },
    body: JSON.stringify(payload),
  });
}

it('enforces session CSRF and allows an anonymous same-origin report to reach configuration', async () => {
  const cookie = `barghsa_session=${sessionId}`;
  expect((await report(body, { cookie })).status).toBe(403);
  expect((await report(body, { cookie, 'x-csrf-token': 'wrong-token' })).status).toBe(403);
  expect((await report(body, { cookie, 'x-csrf-token': csrf })).status).toBe(503);
  expect((await report()).status).toBe(503);
});

it('rejects origin changes, private data and oversized request bodies', async () => {
  const privateText = 'PRIVATE-FORM-VALUE';
  expect((await report(body, { origin: 'https://attacker.example.test' })).status).toBe(403);
  expect((await report({ ...body, form: privateText })).status).toBe(400);
  expect((await report({ ...body, form: privateText.repeat(100) })).status).toBe(413);
  expect(fixture.logs()).not.toContain(privateText);
});

it('rate limits repeated diagnostics even when the receiver is unavailable', async () => {
  let status = 503;
  let attempts = 0;
  while (status === 503 && attempts < 21) {
    attempts++;
    status = (await report()).status;
  }
  expect(attempts).toBeGreaterThan(1);
  expect(status).toBe(429);
});
