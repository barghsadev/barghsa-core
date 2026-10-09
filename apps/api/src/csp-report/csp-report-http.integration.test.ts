import { afterAll, beforeAll, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { startHttpFixture } from '../test/http-fixture.js';

let fixture: Awaited<ReturnType<typeof startHttpFixture>>;
const sessionId = randomUUID();
beforeAll(async () => {
  fixture = await startHttpFixture(process.env.TEST_DATABASE_URL!);
  await fixture.pool.query(
    "INSERT INTO users(user_id,username,password_hash) VALUES ('csp-user','csp-user@example.test','fixture-only')"
  );
  await fixture.pool.query(
    "INSERT INTO sessions(session_id,user_id,csrf_token,family_id,expires_at,idle_deadline) VALUES ($1,'csp-user',$2,$3,NOW()+INTERVAL '1 day',NOW()+INTERVAL '1 hour')",
    [sessionId, randomUUID(), randomUUID()]
  );
}, 30000);
afterAll(async () => {
  await fixture?.close();
});
const report = {
  'csp-report': {
    'document-uri': 'https://app.example.test/private-token?secret=private-token',
    'blocked-uri': 'inline',
    'effective-directive': 'script-src-elem',
    'original-policy': "script-src 'nonce-private-token'",
    'script-sample': 'private-token',
    'source-file': 'https://user:private-token@app.example.test/path?token=private-token',
    'line-number': 12,
    disposition: 'report',
  },
};
function send(body: string, headers: Record<string, string> = {}) {
  return fetch(fixture.base + '/api/csp-report', {
    method: 'POST',
    mode: headers['sec-fetch-mode'] === 'no-cors' ? 'no-cors' : 'cors',
    headers: {
      'content-type': 'application/csp-report',
      origin: 'https://app.example.test',
      ...headers,
    },
    body,
  });
}
it('parses native browser reports and logs only bounded safe diagnostics with correlation', async () => {
  const response = await send(JSON.stringify(report));
  expect(response.status).toBe(204);
  await expect.poll(() => fixture.logs()).toContain('CSP violation');
  expect(fixture.logs()).toContain('script-src-elem');
  expect(fixture.logs()).toContain(response.headers.get('x-correlation-id'));
  expect(fixture.logs()).not.toContain('private-token');
});
it.each([
  '{',
  'null',
  '[]',
  '{"csp-report":null}',
  '{"csp-report":{"original-policy":12}}',
  '{"csp-report":{"line-number":-1}}',
])('rejects malformed native reports: %s', async (body) => {
  const response = await send(body);
  expect(response.status).toBe(400);
  expect(((await response.json()) as { error: { code: string } }).error.code).toBe(
    'VALIDATION:INPUT:INVALID'
  );
});
it('bounds native report bodies', async () => {
  const response = await send(
    JSON.stringify({ 'csp-report': { 'script-sample': 'x'.repeat(17000) } })
  );
  expect(response.status).toBe(413);
});
it('rejects cross-origin reports even with a valid session cookie', async () => {
  const response = await send(JSON.stringify(report), {
    cookie: `barghsa_session=${sessionId}`,
    origin: 'https://attacker.example.test',
  });
  expect(response.status).toBe(403);
  expect(((await response.json()) as { error: { code: string } }).error.code).toBe(
    'AUTHZ:CSRF_TOKEN_INVALID'
  );
});

it('accepts bounded same-origin native telemetry with cookies without a CSRF token', async () => {
  const response = await send(JSON.stringify(report), {
    cookie: `barghsa_session=${sessionId}`,
    'sec-fetch-site': 'same-origin',
  });
  expect(response.status).toBe(204);
});
it.each([
  { origin: 'null' },
  { 'sec-fetch-site': 'cross-site' },
  { 'content-type': 'application/json' },
])('rejects invalid native telemetry provenance or media type: %j', async (headers) => {
  expect((await send(JSON.stringify(report), headers)).status).toBe(403);
});

it('accepts native WebKit opaque-origin reports only with protected same-origin/no-cors metadata', async () => {
  expect(
    (
      await send(JSON.stringify(report), {
        origin: 'null',
        'sec-fetch-site': 'same-origin',
        'sec-fetch-mode': 'no-cors',
      })
    ).status
  ).toBe(204);
  expect(
    (
      await send(JSON.stringify(report), {
        origin: 'null',
        'sec-fetch-site': 'cross-site',
        'sec-fetch-mode': 'no-cors',
      })
    ).status
  ).toBe(403);
  expect(
    (await send(JSON.stringify(report), { origin: 'null', 'sec-fetch-mode': 'no-cors' })).status
  ).toBe(403);
});
