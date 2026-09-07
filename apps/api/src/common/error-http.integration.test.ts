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

it.each(
  [
    '/api/auth/login',
    '/api/admin/contract-templates/550e8400-e29b-41d4-a716-446655440000/versions',
  ].flatMap((path) => [
    { path, locale: 'en', message: 'Invalid input value' },
    { path, locale: 'fa', message: 'مقدار ورودی نامعتبر است' },
  ])
)('does not echo malformed JSON input ($locale, $path)', async ({ path, locale, message }) => {
  const response = await fetch(fixture.base + path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Accept-Language': locale },
    body: 'secret-token',
  });
  expect(response.status).toBe(400);
  const text = await response.text();
  expect(text).not.toContain('secret-token');
  const body = JSON.parse(text);
  expect(body.error.code).toBe('VALIDATION:INPUT:INVALID');
  expect(body.error.message).toBe(message);
});
