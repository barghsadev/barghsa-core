import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { reportBrowserError, reportServerError } from './error-reporting.js';

const dsn = 'https://fixturekey@receiver.example.test/17';
const reference = '12345678-1234-4123-8123-123456789abc';
const transport = vi.fn<typeof fetch>();

beforeEach(() => {
  vi.stubEnv('SERVER_ERROR_SENTRY_DSN', dsn);
  vi.stubEnv('ROUTE_ERROR_SENTRY_DSN', dsn);
  vi.stubEnv('NODE_ENV', 'production');
  vi.stubEnv('BARGHSA_DEPLOYMENT_ENV', 'staging');
  vi.stubGlobal('fetch', transport);
  transport.mockImplementation(async (_url, options) => {
    const header = JSON.parse(String(options?.body).split('\n')[0]!) as { event_id: string };
    return Response.json({ id: header.event_id });
  });
});

afterEach(() => {
  transport.mockReset();
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

it('keeps a raw route query, invalid release value and arbitrary data out of an error envelope', async () => {
  const privateValue = 'private-token-and-profile';
  vi.stubEnv('BARGHSA_RELEASE_SHA', privateValue);
  await reportServerError('API_REQUEST_FAILED', `/api/orders?private=${privateValue}`);
  expect(transport).toHaveBeenCalledOnce();
  const [, options] = transport.mock.calls[0]!;
  expect(String(options?.body)).not.toContain(privateValue);
  expect(JSON.parse(String(options?.body).split('\n')[2]!)).toMatchObject({
    environment: 'staging',
    fingerprint: ['API_REQUEST_FAILED'],
    tags: { process: 'api' },
  });
});

it.each(['development', 'staging'])('samples eligible events in %s', async (environment) => {
  vi.stubEnv('BARGHSA_DEPLOYMENT_ENV', environment);
  vi.stubEnv('SENTRY_ERROR_SAMPLE_RATE', '0');
  await reportServerError('WORKER_POLLER_FAILED');
  expect(transport).toHaveBeenCalledOnce();
});

it('samples production errors at the default or configured fraction', async () => {
  vi.stubEnv('BARGHSA_DEPLOYMENT_ENV', 'production');
  vi.stubEnv('SENTRY_ERROR_SAMPLE_RATE', 'invalid');
  const roll = vi.spyOn(Math, 'random').mockReturnValue(0.1);
  await reportServerError('WORKER_POLLER_FAILED');
  expect(transport).not.toHaveBeenCalled();
  roll.mockReturnValue(0.099);
  await reportServerError('WORKER_POLLER_FAILED');
  expect(transport).toHaveBeenCalledOnce();
  vi.stubEnv('SENTRY_ERROR_SAMPLE_RATE', '1');
  roll.mockReturnValue(0.999);
  await reportServerError('WORKER_POLLER_FAILED');
  expect(transport).toHaveBeenCalledTimes(2);
});

it('caps concurrent server reports without occupying browser delivery slots and recovers', async () => {
  let release!: () => void;
  const blocked = new Promise<void>((resolve) => {
    release = resolve;
  });
  transport.mockImplementationOnce(async () => {
    await blocked;
    throw new Error('receiver unavailable');
  });
  for (let count = 0; count < 3; count++) {
    transport.mockImplementationOnce(async () => {
      await blocked;
      return new Response(null, { status: 429 });
    });
  }
  const reports = Array.from({ length: 4 }, () => reportServerError('WORKER_POLLER_FAILED'));
  try {
    await reportServerError('WORKER_POLLER_FAILED');
    expect(transport).toHaveBeenCalledTimes(4);
    await expect(reportBrowserError('CHUNK_LOAD_FAILED', reference)).resolves.toBe('acknowledged');
    expect(transport).toHaveBeenCalledTimes(5);
  } finally {
    release();
    await Promise.all(reports);
  }
  await reportServerError('WORKER_POLLER_FAILED');
  expect(transport).toHaveBeenCalledTimes(6);
});
