import { afterAll, afterEach, beforeAll, expect, it, vi } from 'vitest';
import { Pool } from 'pg';
import { PostgreSqlContainer } from '@testcontainers/postgresql';

let pool: Pool;
let poolError: Error | null = null;
vi.mock('./index.js', () => ({
  getDbPool: () => {
    if (poolError) throw poolError;
    return pool;
  },
}));
import { collectPerformanceMetrics } from './metrics.js';

beforeAll(() => {
  pool = new Pool({ connectionString: process.env.TEST_DATABASE_URL, max: 8 });
});
afterEach(() => {
  vi.restoreAllMocks();
  poolError = null;
});
afterAll(async () => {
  await pool.end();
});

it('collects PostgreSQL 17 checkpoints and exposes an absent query extension as unavailable', async () => {
  const result = await collectPerformanceMetrics();
  expect(result.ok).toBe(true);
  expect(result.metrics?.bgwriter).toMatchObject({
    checkpoints_timed: expect.any(Number),
    checkpoints_req: expect.any(Number),
  });
  expect(result.metrics?.maxConnections).toBeGreaterThan(0);
  expect(result.metrics?.wal?.wal_bytes).toBeGreaterThanOrEqual(0);
  expect(result.metrics?.topQueries).toBeNull();
});

it('returns failure instead of healthy zeros when all database reads fail', async () => {
  vi.spyOn(pool, 'query').mockRejectedValue(new Error('connection lost'));
  const result = await collectPerformanceMetrics();
  expect(result.ok).toBe(false);
  expect(result.metrics).toBeNull();
  expect(result.error).toBeTruthy();
});

it('fails the core snapshot when one required view fails while others remain readable', async () => {
  vi.spyOn(pool, 'query').mockRejectedValueOnce(new Error('stats view denied'));
  const result = await collectPerformanceMetrics();
  expect(result).toMatchObject({ ok: false, metrics: null });
  expect((await pool.query('SELECT 1 AS ready')).rows[0].ready).toBe(1);
});

it('returns structured failure when the pool is unavailable', async () => {
  poolError = new Error('pool is not initialized');
  await expect(collectPerformanceMetrics()).resolves.toMatchObject({
    ok: false,
    metrics: null,
    error: 'pool is not initialized',
  });
});

it.each([
  [0, 30],
  [101, 30],
  [1.5, 30],
  [10, -1],
  [10, Infinity],
])('rejects invalid collection bounds %s / %s before querying', async (topN, threshold) => {
  const query = vi.spyOn(pool, 'query');
  expect((await collectPerformanceMetrics(topN, threshold)).ok).toBe(false);
  expect(query).not.toHaveBeenCalled();
});

it('collects query timings when pg_stat_statements is enabled on PostgreSQL 17', async () => {
  const container = await new PostgreSqlContainer('postgres:17-alpine')
    .withCommand(['postgres', '-c', 'shared_preload_libraries=pg_stat_statements'])
    .start();
  const previous = pool;
  const monitored = new Pool({ connectionString: container.getConnectionUri(), max: 8 });
  try {
    pool = monitored;
    await pool.query('CREATE EXTENSION pg_stat_statements');
    await pool.query('SELECT generate_series(1, 25) AS metric_probe');
    const result = await collectPerformanceMetrics(100);
    expect(result.ok).toBe(true);
    expect(result.metrics?.topQueries).not.toBeNull();
    const probe = result.metrics?.topQueries?.find((query) => query.query.includes('metric_probe'));
    expect(probe?.calls).toBeGreaterThanOrEqual(1);
    expect(probe?.rows).toBeGreaterThanOrEqual(25);
    expect(probe?.blkReadTimeMs).toBeGreaterThanOrEqual(0);
    expect(probe?.blkWriteTimeMs).toBeGreaterThanOrEqual(0);
  } finally {
    pool = previous;
    await monitored.end();
    await container.stop();
  }
}, 60_000);
