import { afterAll, beforeAll, expect, it } from 'vitest';
import { startHttpFixture } from '../test/http-fixture.js';

let fixture: Awaited<ReturnType<typeof startHttpFixture>>;

beforeAll(async () => {
  fixture = await startHttpFixture(process.env.TEST_DATABASE_URL!);
}, 60_000);
afterAll(async () => {
  await fixture?.close();
});

it('counts completed HTTP outcomes with route templates and keeps request data out of metrics', async () => {
  const request = (path: string, init?: RequestInit) => fetch(`${fixture.base}${path}`, init);
  expect((await request('/api/public/branding/config')).status).toBe(200);
  for (const profile of ['private-profile-one', 'private-profile-two']) {
    const response = await request(`/api/profiles/${profile}/addresses?token=private-query`);
    expect(response.status).toBe(401);
  }
  expect((await request('/api/nonexistent/private-path')).status).toBe(404);
  expect(
    (
      await request('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{"password":"private-malformed-body"',
      })
    ).status
  ).toBe(400);
  expect((await request('/api/health/live')).status).toBe(200);
  expect((await request('/api/health/ready')).status).toBe(200);
  const scrape = await request('/metrics');
  expect(scrape.status).toBe(200);
  const metrics = await scrape.text();
  const counts = metrics
    .split('\n')
    .filter((line) => line.startsWith('barghsa_http_request_duration_seconds_count{'));
  expect(counts).toEqual(
    expect.arrayContaining([
      'barghsa_http_request_duration_seconds_count{route="/api/public/branding/config",method="GET",status="200"} 1',
      'barghsa_http_request_duration_seconds_count{route="/api/profiles/:profileId/addresses",method="GET",status="401"} 2',
      'barghsa_http_request_duration_seconds_count{route="unmatched",method="GET",status="404"} 1',
      'barghsa_http_request_duration_seconds_count{route="unmatched",method="POST",status="400"} 1',
    ])
  );
  expect(counts).toHaveLength(4);
  expect(metrics).toContain(
    'barghsa_http_request_duration_seconds_bucket{le="+Inf",route="/api/profiles/:profileId/addresses",method="GET",status="401"} 2'
  );
  expect(metrics).not.toMatch(/private-profile|private-query|private-path|private-malformed-body/);
});
