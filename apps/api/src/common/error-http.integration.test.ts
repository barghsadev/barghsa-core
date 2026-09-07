import { afterAll, beforeAll, expect, it } from 'vitest';
import { startHttpFixture } from '../test/http-fixture.js';

let fixture: Awaited<ReturnType<typeof startHttpFixture>>;
beforeAll(async () => {
  fixture = await startHttpFixture(process.env.TEST_DATABASE_URL!);
}, 30_000);
afterAll(async () => {
  await fixture?.close();
});

it.each([
  { name: 'authentication guard', path: '/api/profiles', status: 401, init: {} },
  { name: 'unknown route', path: '/api/missing-boundary-test', status: 404, init: {} },
  {
    name: 'JSON parser',
    path: '/api/auth/login',
    status: 400,
    init: {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: 'private-parser-marker',
    },
  },
])('keeps $name errors private and binds their correlation ID', async ({ path, status, init }) => {
  const response = await fetch(fixture.base + path, init);
  expect(response.status).toBe(status);
  expect(response.headers.get('cache-control')).toContain('private');
  expect(response.headers.get('cache-control')).toContain('no-store');
  const body = (await response.json()) as { error: { code: string; correlationId: string } };
  expect(body.error.code).toEqual(expect.any(String));
  expect(body.error.correlationId).toMatch(
    /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
  );
  expect(response.headers.get('x-correlation-id')).toBe(body.error.correlationId);
});
