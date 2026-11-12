import { createServer, type Server } from 'node:http';
import { setTimeout as wait } from 'node:timers/promises';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { startHttpFixture } from '../test/http-fixture.js';

let fixture: Awaited<ReturnType<typeof startHttpFixture>>;
let receiver: Server;
let requests = 0;
const accepted: unknown[] = [];
type Trace = {
  name: string;
  traceId: string;
  spanId: string;
  parentSpanId?: string;
  status: { code?: number };
  attributes: { key: string; value: Record<string, unknown> }[];
};
const traces: Trace[] = [];
beforeAll(async () => {
  receiver = createServer(async (request, response) => {
    const chunks: Buffer[] = [];
    for await (const chunk of request) chunks.push(Buffer.from(chunk));
    const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    if (request.url === '/v1/traces') {
      const { resourceSpans } = body as {
        resourceSpans: { scopeSpans: { spans: Trace[] }[] }[];
      };
      for (const resource of resourceSpans)
        for (const scope of resource.scopeSpans) traces.push(...scope.spans);
      response.writeHead(200, { 'content-type': 'application/json' }).end('{}');
      return;
    }
    requests++;
    if (requests === 1) {
      response.writeHead(503).end();
      return;
    }
    accepted.push(body);
    response.writeHead(200, { 'content-type': 'application/json' }).end('{}');
  });
  await new Promise<void>((done) => receiver.listen(0, '127.0.0.1', done));
  const address = receiver.address();
  if (!address || typeof address === 'string') throw new Error('Missing collector address');
  fixture = await startHttpFixture(process.env.TEST_DATABASE_URL!, undefined, '', 10, '', false, {
    endpoint: `http://127.0.0.1:${address.port}/v1/metrics`,
    intervalMs: 1000,
    timeoutMs: 1000,
    traces: { endpoint: `http://127.0.0.1:${address.port}/v1/traces`, sampleRate: 0 },
  });
}, 60_000);
afterAll(async () => {
  await fixture?.close();
  if (receiver) await new Promise<void>((done) => receiver.close(() => done()));
});

it('exports database metrics over OTLP and keeps serving after a collector failure', async () => {
  const response = await fetch(`${fixture.base}/metrics`);
  expect(response.status).toBe(200);
  await expect
    .poll(() => JSON.stringify(accepted), { timeout: 15_000 })
    .toContain('postgresql.connections.active');
  const payload = JSON.stringify(accepted);
  expect(payload).toContain('barghsa.postgresql');
  expect(payload).toContain('postgresql.cache.hit_ratio');
  expect(payload).toContain('postgresql.scans.sequential');
  expect(payload).toContain('postgresql.scans.index');
  expect(payload).toContain('postgresql.tuples.fetched');
  expect(payload).not.toContain('SELECT ');
  expect(requests).toBeGreaterThanOrEqual(2);
  expect((await fetch(`${fixture.base}/api/health/live`)).status).toBe(200);
}, 25_000);

it('serves public health probes with real PostgreSQL statistics and no rate or audit writes', async () => {
  const operationalWrites = async () =>
    (
      await fixture.pool.query(
        `SELECT (SELECT count(*)::int FROM rate_limit_windows) AS rate_windows,
                (SELECT count(*)::int FROM audit_log) AS audit_entries`
      )
    ).rows[0];
  const before = await operationalWrites();
  const liveness = await fetch(`${fixture.base}/api/health/live`);
  expect(liveness.status).toBe(200);
  expect(await liveness.json()).toEqual({ status: 'ok' });
  const results = await Promise.all(
    Array.from({ length: 20 }, async () => {
      const response = await fetch(`${fixture.base}/api/health/ready`);
      expect(response.status).toBe(200);
      return response.json();
    })
  );
  for (const result of results) {
    expect(result).toMatchObject({
      checks: {
        postgresql: {
          status: 'ok',
          latencyMs: expect.any(Number),
          details: {
            poolStats: {
              totalCount: expect.any(Number),
              idleCount: expect.any(Number),
              waitingCount: 0,
            },
          },
        },
      },
    });
  }
  expect(await operationalWrites()).toEqual(before);
});

it('returns 503 for incompatible schema metadata while liveness stays available', async () => {
  const traceId = '61616161616161616161616161616161';
  const parentSpanId = '6262626262626262';
  const latest = (
    await fixture.pool.query(
      'SELECT id,hash FROM drizzle.__drizzle_migrations ORDER BY created_at DESC LIMIT 1'
    )
  ).rows[0];
  try {
    await fixture.pool.query(
      "UPDATE drizzle.__drizzle_migrations SET hash='wrong-artifact' WHERE id=$1",
      [latest.id]
    );
    const response = await fetch(`${fixture.base}/api/health/ready?private=fixture-private-query`, {
      headers: {
        traceparent: `00-${traceId}-${parentSpanId}-00`,
        tracestate: 'fixture=fixture-private-tracestate',
        'x-fixture': 'fixture-private-header',
      },
    });
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({
      error: { code: 'PROVIDER:UNAVAILABLE', correlationId: expect.any(String) },
    });
    expect((await fetch(`${fixture.base}/api/health/live`)).status).toBe(200);
  } finally {
    await fixture.pool.query('UPDATE drizzle.__drizzle_migrations SET hash=$1 WHERE id=$2', [
      latest.hash,
      latest.id,
    ]);
  }
  expect((await fetch(`${fixture.base}/api/health/ready`)).status).toBe(200);
  await expect
    .poll(() => traces.find((span) => span.traceId === traceId), { timeout: 7000 })
    .toMatchObject({
      name: 'GET /api/health/ready',
      traceId,
      parentSpanId,
      status: { code: 2 },
      attributes: expect.arrayContaining([
        { key: 'http.route', value: { stringValue: '/api/health/ready' } },
        { key: 'http.response.status_code', value: { intValue: 503 } },
      ]),
    });
  expect(traces.filter((span) => span.traceId === traceId)).toHaveLength(1);
  expect(JSON.stringify(traces)).not.toContain('fixture-private-');
});

it.each([
  { outcome: 'slow successful', abort: false, traceId: '71717171717171717171717171717171' },
  { outcome: 'interrupted', abort: true, traceId: '73737373737373737373737373737373' },
])(
  'exports a $outcome request even with routine trace sampling disabled',
  async ({ abort, traceId }) => {
    const parentSpanId = '7272727272727272';
    const locker = await fixture.pool.connect();
    const controller = new AbortController();
    let response: Promise<{ status: number } | { error: string }> | undefined;
    try {
      await locker.query('BEGIN');
      await locker.query('LOCK TABLE drizzle.__drizzle_migrations IN ACCESS EXCLUSIVE MODE');
      response = fetch(`${fixture.base}/api/health/ready`, {
        headers: { traceparent: `00-${traceId}-${parentSpanId}-00` },
        signal: controller.signal,
      }).then(
        ({ status }) => ({ status }),
        (error: Error) => ({ error: error.name })
      );
      await expect
        .poll(
          async () =>
            (
              await fixture.pool.query(
                `SELECT EXISTS (SELECT 1 FROM pg_locks
           WHERE relation='drizzle.__drizzle_migrations'::regclass AND NOT granted) AS waiting`
              )
            ).rows[0]?.waiting,
          { timeout: 3000 }
        )
        .toBe(true);
      if (abort) controller.abort();
      else await wait(550);
    } finally {
      await locker.query('ROLLBACK');
      locker.release();
    }
    expect(await response).toEqual(abort ? { error: 'AbortError' } : { status: 200 });
    await expect
      .poll(() => traces.find((span) => span.traceId === traceId), { timeout: 7000 })
      .toMatchObject({
        traceId,
        parentSpanId,
        ...(abort
          ? { status: { code: 2 } }
          : {
              attributes: expect.arrayContaining([
                { key: 'http.response.status_code', value: { intValue: 200 } },
              ]),
            }),
      });
    expect(traces.filter((span) => span.traceId === traceId)).toHaveLength(1);
  }
);

it('logs an independent valid context for duplicate trace headers without recording the raw URL', async () => {
  const repeated = '81818181818181818181818181818181';
  const headers = new Headers();
  headers.append('traceparent', `00-${repeated}-8282828282828282-01`);
  headers.append('traceparent', '00-83838383838383838383838383838383-8484848484848484-01');
  const response = await fetch(
    `${fixture.base}/api/fixture-private-path?private=fixture-private-query`,
    { headers }
  );
  expect(response.status).toBe(404);
  const correlationId = response.headers.get('x-correlation-id');
  expect(correlationId).toBeTruthy();
  let matched: { traceId?: string; spanId?: string } | undefined;
  await expect
    .poll(() => {
      matched = fixture
        .logs()
        .split('\n')
        .filter((line) => line.startsWith('{'))
        .map((line) => JSON.parse(line))
        .find((log) => log.event === 'http.request' && log.correlationId === correlationId);
      return matched;
    })
    .toMatchObject({
      traceId: expect.stringMatching(/^[a-f0-9]{32}$/),
      spanId: expect.stringMatching(/^[a-f0-9]{16}$/),
    });
  expect(matched?.traceId).not.toBe(repeated);
  expect(matched?.traceId).not.toBe('83838383838383838383838383838383');
  expect(fixture.logs()).not.toContain('fixture-private-');
});
