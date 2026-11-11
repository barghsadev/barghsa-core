import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import { startHttpFixture } from '../test/http-fixture.js';

let fixture: Awaited<ReturnType<typeof startHttpFixture>>;
const revision = 'a3'.repeat(20);

async function startWithRevision(value: string | undefined, environment: string) {
  const previous = process.env.BARGHSA_RELEASE_SHA;
  const previousEnvironment = process.env.BARGHSA_DEPLOYMENT_ENV;
  vi.stubEnv('BARGHSA_RELEASE_SHA', value);
  vi.stubEnv('BARGHSA_DEPLOYMENT_ENV', environment);
  try {
    return await startHttpFixture(process.env.TEST_DATABASE_URL!);
  } finally {
    vi.stubEnv('BARGHSA_RELEASE_SHA', previous);
    vi.stubEnv('BARGHSA_DEPLOYMENT_ENV', previousEnvironment);
  }
}

beforeAll(async () => {
  fixture = await startWithRevision(revision, 'staging');
}, 60_000);
afterAll(async () => {
  await fixture?.close();
});

it('counts completed HTTP outcomes with route templates and keeps request data out of metrics', async () => {
  const request = async (path: string, init?: RequestInit) => {
    const response = await fetch(`${fixture.base}${path}`, init);
    expect(response.headers.get('X-Environment')).toBe('staging');
    return response;
  };
  expect(
    (await request('/api/public/branding/config', { headers: { 'X-Environment': 'production' } }))
      .status
  ).toBe(200);
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
  expect(metrics).toContain(`barghsa_api_release_info{revision="${revision}"} 1\n`);
  const journeys = metrics
    .split('\n')
    .filter((line) => line.startsWith('barghsa_rollout_journey_attempts_total{'));
  expect(journeys).toEqual(
    ['electricity', 'saving', 'solar', 'consultation'].flatMap((service) =>
      ['success', 'failure'].map(
        (outcome) =>
          `barghsa_rollout_journey_attempts_total{revision="${revision}",service="${service}",outcome="${outcome}"} 0`
      )
    )
  );
});

it.each([
  { value: 'private-invalid-release', environment: 'development', expected: 'development' },
  { value: undefined, environment: 'private-invalid-environment', expected: 'production' },
])(
  'omits the release series for an invalid or absent build revision ($value)',
  async ({ value, environment, expected }) => {
    const isolated = await startWithRevision(value, environment);
    try {
      const response = await fetch(`${isolated.base}/metrics`);
      expect(response.status).toBe(200);
      expect(response.headers.get('X-Environment')).toBe(expected);
      expect(await response.text()).not.toMatch(
        /barghsa_api_release_info|barghsa_rollout_journey_attempts_total|private-invalid-release/
      );
    } finally {
      await isolated.close();
    }
  },
  40_000
);
