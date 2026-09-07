import { createServer } from 'node:http';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createDatabaseTelemetry, type DatabaseTelemetrySnapshot } from './database-telemetry.js';
import { createMetricsSnapshot } from '../test/metrics-fixture.js';

beforeEach(() => {
  vi.stubEnv('OTEL_EXPORTER_OTLP_METRICS_ENDPOINT', '');
  vi.stubEnv('OTEL_EXPORTER_OTLP_METRICS_HEADERS', '');
  vi.stubEnv('OTEL_EXPORTER_OTLP_HEADERS', '');
});
afterEach(() => {
  vi.unstubAllEnvs();
});

it('creates no exporter without an explicit metrics endpoint', () => {
  expect(createDatabaseTelemetry(() => ({ metrics: null, replicationLag: null }))).toBeNull();
});
it.each(['not a URL', 'file:///tmp/metrics'])('rejects invalid endpoint %s', (endpoint) => {
  expect(() =>
    createDatabaseTelemetry(() => ({ metrics: null, replicationLag: null }), { endpoint })
  ).toThrow(/Invalid OTLP/);
});
it.each([
  { intervalMs: 0 },
  { intervalMs: 1.5 },
  { intervalMs: 300001 },
  { timeoutMs: 0 },
  { timeoutMs: 15001 },
  { intervalMs: 1000, timeoutMs: 2000 },
])('rejects invalid exporter timing %j', (timing) => {
  expect(() =>
    createDatabaseTelemetry(() => ({ metrics: null, replicationLag: null }), {
      endpoint: 'http://127.0.0.1:1/v1/metrics',
      ...timing,
    })
  ).toThrow('Invalid OTLP metrics timing');
});

type Point = { asDouble?: number; asInt?: string };
type Metric = { name: string; gauge?: { dataPoints: Point[] }; sum?: { dataPoints: Point[] } };
type Payload = { resourceMetrics: { scopeMetrics: { metrics: Metric[] }[] }[] };
it('exports exact current samples and omits stale samples through failure and recovery', async () => {
  const received: Payload[] = [];
  const receiver = createServer(async (request, response) => {
    const chunks: Buffer[] = [];
    for await (const chunk of request) chunks.push(Buffer.from(chunk));
    received.push(JSON.parse(Buffer.concat(chunks).toString('utf8')) as Payload);
    response.writeHead(200, { 'content-type': 'application/json' }).end('{}');
  });
  await new Promise<void>((done) => receiver.listen(0, '127.0.0.1', done));
  const address = receiver.address();
  if (!address || typeof address === 'string') throw new Error('Missing collector address');
  let current: DatabaseTelemetrySnapshot = { metrics: createMetricsSnapshot(), replicationLag: 12 };
  let snapshotError = false;
  const provider = createDatabaseTelemetry(
    () => {
      if (snapshotError) throw new Error('snapshot unavailable');
      return current;
    },
    {
      endpoint: `http://127.0.0.1:${address.port}/v1/metrics`,
      intervalMs: 60000,
      timeoutMs: 1000,
    }
  )!;
  const points = (name: string) =>
    received
      .at(-1)!
      .resourceMetrics.flatMap((resource) => resource.scopeMetrics)
      .flatMap((scope) => scope.metrics)
      .filter((metric) => metric.name === name)
      .flatMap((metric) => metric.gauge?.dataPoints ?? metric.sum?.dataPoints ?? [])
      .map((point) => point.asDouble ?? Number(point.asInt));
  try {
    await provider.forceFlush();
    expect(points('postgresql.connections.active')).toEqual([10]);
    expect(points('postgresql.replication.lag')).toEqual([12]);
    expect(points('postgresql.query.calls')).toEqual([55]);
    current = { metrics: null, replicationLag: null };
    await provider.forceFlush();
    expect(points('postgresql.collection.success')).toEqual([0]);
    expect(points('postgresql.connections.active')).toEqual([]);
    expect(points('postgresql.query.calls')).toEqual([]);
    current = {
      metrics: { ...createMetricsSnapshot(), activeConnections: 20 },
      replicationLag: null,
    };
    await provider.forceFlush();
    expect(points('postgresql.collection.success')).toEqual([1]);
    expect(points('postgresql.connections.active')).toEqual([20]);
    expect(points('postgresql.replication.lag')).toEqual([]);
    snapshotError = true;
    await provider.forceFlush();
    expect(points('postgresql.collection.success')).toEqual([0]);
    expect(points('postgresql.connections.active')).toEqual([]);
  } finally {
    await provider.shutdown({ timeoutMillis: 2000 });
    await new Promise<void>((done) => receiver.close(() => done()));
  }
});
