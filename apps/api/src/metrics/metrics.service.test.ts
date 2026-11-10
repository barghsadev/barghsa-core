import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { Logger } from '@nestjs/common';
import promClient from 'prom-client';
import { createMetricsSnapshot as snapshot } from '../test/metrics-fixture.js';
import { MetricsController } from './metrics.controller.js';
const collector = vi.hoisted(() => ({
  performance: vi.fn(),
  replication: vi.fn(),
  pool: { totalCount: 6, idleCount: 0, waitingCount: 3, options: { max: 6 }, query: vi.fn() },
}));
vi.mock('@barghsa/db', () => ({
  collectPerformanceMetrics: collector.performance,
  collectReplicationLag: collector.replication,
  getDbPool: () => collector.pool,
}));
import { MetricsService } from './metrics.service.js';

let service: MetricsService;
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv('OTEL_EXPORTER_OTLP_METRICS_ENDPOINT', '');
  promClient.register.clear();
  collector.performance.mockResolvedValue({ ok: true, metrics: snapshot(), latencyMs: 1 });
  collector.replication.mockResolvedValue(23);
  collector.pool.query.mockResolvedValue({ rows: [] });
  service = new MetricsService();
});
afterEach(async () => {
  await service.onModuleDestroy();
  promClient.register.clear();
  vi.restoreAllMocks();
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
    expect(text).toMatch(/^pg_pool_connections\{state="active"\} 6$/m);
    expect(text).toMatch(/^pg_pool_connections\{state="idle"\} 0$/m);
    expect(text).toMatch(/^pg_pool_waiting_requests 3$/m);
    expect(text).toMatch(/^pg_pool_capacity 6$/m);
    expect(service.getLastMetrics()).toBeNull();
    collector.performance.mockResolvedValue({ ok: true, metrics: snapshot(), latencyMs: 1 });
    expect(await service.collect()).toMatch(/^pg_metrics_collection_success 1$/m);
  }
);

it('retains fixed collection diagnostics for a failure response and a thrown error', async () => {
  const detail = 'row value PRIVATE_METRICS_FIXTURE';
  const warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
  const error = vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
  collector.performance.mockResolvedValueOnce({ ok: false, metrics: null, error: detail });
  expect(await service.collect()).toMatch(/^pg_metrics_collection_success 0$/m);
  collector.performance.mockRejectedValueOnce(new Error(detail));
  expect(await service.collect()).toMatch(/^pg_metrics_collection_success 0$/m);
  expect(warn.mock.calls).toEqual([['Metrics collection failed']]);
  expect(error.mock.calls).toEqual([['Metrics poll error']]);
});

it('hands a scrape failure to the HTTP filter without logging its private detail', async () => {
  const failure = new Error('PRIVATE_METRICS_SCRAPE_FIXTURE');
  vi.spyOn(service, 'collect').mockRejectedValueOnce(failure);
  const error = vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
  await expect(new MetricsController(service).getMetrics()).rejects.toBe(failure);
  expect(error.mock.calls).toEqual([['Failed to serve /metrics']]);
});

it('removes unavailable optional samples instead of publishing zero or the previous sample', async () => {
  const healthy = await service.collect();
  expect(healthy).toMatch(/^pg_checkpoints_timed_total 12$/m);
  expect(healthy).toMatch(/^pg_query_calls_total 55$/m);
  expect(healthy).toMatch(/^pg_sequential_scans_total 12$/m);
  expect(healthy).toMatch(/^pg_index_scans_total 34$/m);
  expect(healthy).toMatch(/^ai_inference_active_requests 0$/m);
  expect(healthy).toMatch(/^ai_inference_queue_depth 0$/m);
  expect(healthy).toMatch(/^ai_inference_saturated 0$/m);
  expect(healthy).toMatch(/^ai_inference_rejections_total 0$/m);
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

it('clears an unavailable model budget view while retaining circuit and database samples', async () => {
  let budgetAvailable = true;
  collector.pool.query.mockImplementation(async (sql: string) => {
    if (sql.includes('ai_model_circuit_states'))
      return { rows: [{ id: 'model', degraded: false }] };
    if (!budgetAvailable) throw new Error('budget view unavailable');
    return { rows: [{ model_id: 'model', usd: 1.234 }] };
  });
  expect(await service.collect()).toContain('ai_model_monthly_spend_usd{model_id="model"} 1.234\n');
  budgetAvailable = false;
  const unavailable = await service.collect();
  expect(unavailable).not.toContain('ai_model_monthly_spend_usd{');
  expect(unavailable).toContain('ai_model_health{model_id="model"} 1\n');
  expect(unavailable).toMatch(/^pg_metrics_collection_success 1$/m);
});
