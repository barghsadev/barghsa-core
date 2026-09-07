import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import promClient from 'prom-client';
import { createMetricsSnapshot as snapshot } from '../test/metrics-fixture.js';
const collector = vi.hoisted(() => ({ performance: vi.fn(), replication: vi.fn() }));
vi.mock('@barghsa/db', () => ({
  collectPerformanceMetrics: collector.performance,
  collectReplicationLag: collector.replication,
}));
import { MetricsService } from './metrics.service.js';

let service: MetricsService;
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv('OTEL_EXPORTER_OTLP_METRICS_ENDPOINT', '');
  promClient.register.clear();
  collector.performance.mockResolvedValue({ ok: true, metrics: snapshot(), latencyMs: 1 });
  collector.replication.mockResolvedValue(23);
  service = new MetricsService();
});
afterEach(async () => {
  await service.onModuleDestroy();
  promClient.register.clear();
  vi.unstubAllEnvs();
});

it.each(['failed', 'thrown'])(
  'clears old samples and marks a %s collection unavailable',
  async (failure) => {
    expect(await service.collect()).toMatch(/^pg_cache_hit_ratio 0.98$/m);
    if (failure === 'failed') collector.performance.mockResolvedValue({ ok: false, metrics: null });
    else collector.performance.mockRejectedValue(new Error('database unavailable'));
    const text = await service.collect();
    expect(text).toMatch(/^pg_metrics_collection_success 0$/m);
    expect(text).not.toMatch(/^pg_cache_hit_ratio /m);
    expect(text).not.toMatch(/^pg_checkpoints_timed_total /m);
    expect(service.getLastMetrics()).toBeNull();
    collector.performance.mockResolvedValue({ ok: true, metrics: snapshot(), latencyMs: 1 });
    expect(await service.collect()).toMatch(/^pg_metrics_collection_success 1$/m);
  }
);

it('removes unavailable optional samples instead of publishing zero or the previous sample', async () => {
  const healthy = await service.collect();
  expect(healthy).toMatch(/^pg_checkpoints_timed_total 12$/m);
  expect(healthy).toMatch(/^pg_query_calls_total 55$/m);
  expect(healthy).toMatch(/^pg_sequential_scans_total 12$/m);
  expect(healthy).toMatch(/^pg_index_scans_total 34$/m);
  const missing = {
    ...snapshot(),
    wal: null,
    bgwriter: null,
    topQueries: null,
    queryCalls: null,
    tableScans: null,
  };
  collector.performance.mockResolvedValue({ ok: true, metrics: missing, latencyMs: 1 });
  collector.replication.mockResolvedValue(null);
  const text = await service.collect();
  expect(text).toMatch(/^pg_metrics_collection_success 1$/m);
  expect(text).not.toMatch(/^pg_checkpoints_timed_total /m);
  expect(text).not.toMatch(/^pg_wal_bytes_total /m);
  expect(text).not.toMatch(/^pg_replication_lag_seconds /m);
  expect(text).not.toMatch(/^pg_query_calls_total /m);
  expect(text).not.toMatch(/^pg_sequential_scans_total /m);
  expect(text).not.toMatch(/^pg_index_scans_total /m);
});

it('shares one in-flight database snapshot between concurrent scrapes', async () => {
  let resolve!: (result: unknown) => void;
  const pending = new Promise((done) => {
    resolve = done;
  });
  collector.performance.mockReturnValue(pending);
  const first = service.collect();
  const second = service.collect();
  resolve({ ok: true, metrics: snapshot(), latencyMs: 1 });
  await Promise.all([first, second]);
  expect(collector.performance).toHaveBeenCalledOnce();
  expect(collector.replication).toHaveBeenCalledOnce();
});
