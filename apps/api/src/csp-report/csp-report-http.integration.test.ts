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
    headers: { 'content-type': 'application/csp-report', ...headers },
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
it('retains session CSRF protection pending the native-report boundary decision', async () => {
  const response = await send(JSON.stringify(report), { cookie: `barghsa_session=${sessionId}` });
  expect(response.status).toBe(403);
  expect(((await response.json()) as { error: { code: string } }).error.code).toBe(
    'AUTHZ:CSRF_TOKEN_INVALID'
  );
});
