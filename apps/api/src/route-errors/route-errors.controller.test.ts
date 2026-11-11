import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { Request, Response } from 'express';
import { RouteErrorsController } from './route-errors.controller.js';

const dsn = 'https://fixturekey@receiver.example.test/sentry/17';
const body = { code: 'ROUTE_RENDER_FAILED', reference: '12345678-1234-4123-8123-123456789abc' };
const eventId = body.reference.replaceAll('-', '');
const release = 'a1b2c3d4'.repeat(5);
const controller = new RouteErrorsController();
const transport = vi.fn<typeof fetch>();
const end = vi.fn();
const status = vi.fn(() => ({ end }));

function report(payload: unknown, incoming: Request) {
  return controller.report(payload, incoming, { status } as unknown as Response);
}

function request(headers: Record<string, string> = {}): Request {
  return {
    headers: {
      origin: 'https://app.example.test',
      'sec-fetch-site': 'same-origin',
      'content-type': 'application/json',
      cookie: 'private-session',
      referer: 'https://app.example.test/private-form',
      ...headers,
    },
  } as Request;
}

beforeEach(() => {
  vi.stubEnv('APP_PUBLIC_URL', 'https://app.example.test');
  vi.stubEnv('ROUTE_ERROR_SENTRY_DSN', dsn);
  vi.stubEnv('BARGHSA_RELEASE_SHA', release);
  vi.stubEnv('BARGHSA_DEPLOYMENT_ENV', 'staging');
  vi.stubGlobal('fetch', transport);
});

afterEach(() => {
  transport.mockReset();
  status.mockClear();
  end.mockClear();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

it('forwards only safe diagnostics and requires the same event receipt', async () => {
  transport.mockResolvedValueOnce(Response.json({ id: eventId }));
  await expect(report(body, request())).resolves.toBeUndefined();
  expect(transport).toHaveBeenCalledOnce();
  expect(status).toHaveBeenCalledWith(204);
  expect(end).toHaveBeenCalledOnce();
  const [url, options] = transport.mock.calls[0]!;
  expect(String(url)).toBe('https://receiver.example.test/sentry/api/17/envelope/');
  expect(options).toMatchObject({
    method: 'POST',
    headers: { 'Content-Type': 'application/x-sentry-envelope' },
    redirect: 'error',
    signal: expect.any(AbortSignal),
  });
  const [header, item, payload] = String(options?.body).split('\n');
  expect(JSON.parse(header!)).toEqual({ event_id: eventId, dsn });
  expect(JSON.parse(item!)).toEqual({ type: 'event', length: Buffer.byteLength(payload!) });
  expect(JSON.parse(payload!)).toEqual({
    event_id: eventId,
    timestamp: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/),
    platform: 'javascript',
    level: 'error',
    message: body.code,
    fingerprint: [body.code],
    environment: 'staging',
    release,
    tags: { process: 'web', support_reference: body.reference },
  });
});

it('reports a sampled-out production event without acknowledging delivery', async () => {
  vi.stubEnv('BARGHSA_DEPLOYMENT_ENV', 'production');
  vi.stubEnv('SENTRY_ERROR_SAMPLE_RATE', '0');
  await report(body, request());
  expect(status).toHaveBeenCalledWith(202);
  expect(end).toHaveBeenCalledOnce();
  expect(transport).not.toHaveBeenCalled();
});

it.each([undefined, 'invalid release metadata'])(
  'omits an invalid build revision (%s)',
  async (revision) => {
    vi.stubEnv('BARGHSA_RELEASE_SHA', revision);
    transport.mockResolvedValueOnce(Response.json({ id: eventId }));
    await expect(report(body, request())).resolves.toBeUndefined();
    expect(transport).toHaveBeenCalledOnce();
    const [, options] = transport.mock.calls[0]!;
    expect(JSON.parse(String(options?.body).split('\n')[2]!)).not.toHaveProperty('release');
  }
);

it.each([
  { origin: 'https://attacker.example.test' },
  { origin: 'null' },
  { 'sec-fetch-site': 'cross-site' },
  { 'content-type': 'text/plain' },
])('refuses cross-origin or non-JSON requests (%j)', async (headers) => {
  await expect(report(body, request(headers))).rejects.toMatchObject({ status: 403 });
  expect(transport).not.toHaveBeenCalled();
});

it.each([
  null,
  { ...body, stack: 'private stack' },
  { ...body, code: 'private exception' },
  { ...body, reference: 'private profile' },
])('rejects input outside the fixed diagnostic schema', async (invalid) => {
  await expect(report(invalid, request())).rejects.toMatchObject({ status: 400 });
  expect(transport).not.toHaveBeenCalled();
});

it.each([
  '',
  'http://fixturekey@receiver.example.test/17',
  'https://receiver.example.test/17',
  'https://fixturekey:password@receiver.example.test/17',
  'https://fixturekey@receiver.example.test/project',
  'https://fixturekey@receiver.example.test/17?token=private',
  'https://fixturekey@receiver.example.test/17#private',
])('rejects missing or invalid Sentry configuration without egress', async (invalid) => {
  vi.stubEnv('ROUTE_ERROR_SENTRY_DSN', invalid);
  await expect(report(body, request())).rejects.toMatchObject({ status: 503 });
  expect(transport).not.toHaveBeenCalled();
});

it.each([
  () => new Response('private quota detail', { status: 429 }),
  () => Response.json({ id: 'unrelated' }),
  () => new Response('private malformed receipt'),
  () => new Response(null, { status: 204 }),
])('rejects unsuccessful and mismatched provider responses without retrying', async (response) => {
  transport.mockResolvedValueOnce(response());
  await expect(report(body, request())).rejects.toMatchObject({ status: 503 });
  expect(transport).toHaveBeenCalledOnce();
});

it('uses a bounded deadline and never retries a stalled transport', async () => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  const timeout = vi.spyOn(AbortSignal, 'timeout').mockImplementationOnce((ms) => {
    const deadline = new AbortController();
    setTimeout(() => deadline.abort(), ms);
    return deadline.signal;
  });
  try {
    transport.mockImplementationOnce(
      (_url, options) =>
        new Promise((_resolve, reject) =>
          options!.signal!.addEventListener('abort', () => reject(options!.signal!.reason), {
            once: true,
          })
        )
    );
    const rejected = expect(report(body, request())).rejects.toMatchObject({
      status: 503,
    });
    await vi.advanceTimersByTimeAsync(3000);
    await rejected;
    expect(timeout).toHaveBeenCalledWith(3000);
    expect(transport).toHaveBeenCalledOnce();
  } finally {
    timeout.mockRestore();
    vi.useRealTimers();
  }
});

it('cancels a streamed oversized Sentry receipt even when the event ID matches', async () => {
  const cancel = vi.fn();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(
        new TextEncoder().encode(JSON.stringify({ id: eventId, extra: 'x'.repeat(4096) }))
      );
    },
    cancel,
  });
  transport.mockResolvedValueOnce(new Response(stream));
  await expect(report(body, request())).rejects.toMatchObject({ status: 503 });
  expect(cancel).toHaveBeenCalledOnce();
  expect(transport).toHaveBeenCalledOnce();
});
