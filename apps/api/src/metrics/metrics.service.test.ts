import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import promClient from 'prom-client';
import type { DatabaseMetrics } from '@barghsa/db';
const collector = vi.hoisted(() => ({ performance: vi.fn(), replication: vi.fn() }));
vi.mock('@barghsa/db', () => ({
  collectPerformanceMetrics: collector.performance,
  collectReplicationLag: collector.replication,
}));
import { MetricsService } from './metrics.service.js';

function snapshot(): DatabaseMetrics {
  return {
    queryCalls: 55,
    tableScans: { sequential: 12, index: 34 },
    database: {
      xact_commit: 10,
      xact_rollback: 1,
      blks_read: 2,
      blks_hit: 98,
      tup_returned: 100,
      tup_fetched: 50,
      tup_inserted: 4,
      tup_updated: 3,
      tup_deleted: 1,
      conflicts: 0,
      deadlocks: 0,
      blk_read_time: 1,
      blk_write_time: 1,
      temp_files: 0,
      temp_bytes: 0,
    },
    cacheHitRatio: 0.98,
    connectionSaturation: 0.1,
    maxConnections: 100,
    activeConnections: 10,
    idleInTransaction: 0,
    waitingConnections: 0,
    longRunningQueries: [],
    wal: {
      wal_records: 10,
      wal_fpi: 1,
      wal_bytes: 123,
      wal_buffers_full: 0,
      wal_write: 2,
      wal_sync: 2,
      wal_write_time: 1,
      wal_sync_time: 1,
    },
    bgwriter: {
      checkpoints_timed: 12,
      checkpoints_req: 2,
      checkpoint_write_time: 1,
      checkpoint_sync_time: 1,
      buffers_checkpoint: 3,
      buffers_clean: 2,
      maxwritten_clean: 0,
      buffers_backend: null,
      buffers_backend_fsync: null,
      buffers_alloc: 4,
      stats_reset: null,
    },
    topQueries: [],
  };
}
let service: MetricsService;
beforeEach(() => {
  vi.clearAllMocks();
  promClient.register.clear();
  collector.performance.mockResolvedValue({ ok: true, metrics: snapshot(), latencyMs: 1 });
  collector.replication.mockResolvedValue(23);
  service = new MetricsService();
});
afterEach(async () => {
  await service.onModuleDestroy();
  promClient.register.clear();
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
