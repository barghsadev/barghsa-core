import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Pool } from 'pg';
import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import { PostgresRateLimiterStore } from '../../shared/src/rate-limit/postgres-rate-limiter.js';
import { createIsolatedTestDb, dropTestSchema, type IsolatedTestDb } from './test/testDb.js';

let ctx: IsolatedTestDb;
let other: Pool;
let store: PostgresRateLimiterStore;
let second: PostgresRateLimiterStore;
beforeAll(async () => {
  ctx = await createIsolatedTestDb('test_rolling_', 8);
  other = new Pool({ connectionString: ctx.connectionString, max: 8 });
  for (const name of ['rate_limit_counters', 'security_rate_limit_counters']) {
    await ctx.pool.query(`CREATE TABLE ${name} (key text, window_start bigint, window_ms integer,
      count integer, updated_at timestamptz DEFAULT clock_timestamp())`);
  }
  await ctx.pool.query(
    readFileSync(resolve(__dirname, '../drizzle/production/0120_rolling_rate_limits.sql'), 'utf8')
  );
  store = new PostgresRateLimiterStore((text, params) => ctx.pool.query(text, params));
  second = new PostgresRateLimiterStore((text, params) => other.query(text, params));
});
afterAll(async () => {
  await other?.end();
  await ctx?.pool.end();
  if (ctx) await dropTestSchema(ctx.schemaName);
});

it('serializes independent clients: exactly six failures and exactly the admission quota', async () => {
  const key = randomUUID();
  const failed = await Promise.all(
    Array.from({ length: 6 }, (_, i) => (i % 2 ? store : second).incrementSecurity(key, 10, 900000))
  );
  expect(failed.map((r) => 10 - r.remaining).sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5, 6]);
  const requests = await Promise.all(
    Array.from({ length: 40 }, (_, i) => (i % 2 ? store : second).increment(key, 5, 900000))
  );
  expect(requests.filter((r) => r.allowed)).toHaveLength(5);
  expect(await store.getCurrentCount(key, 900000)).toBe(6);
});

it('does not reset at an epoch boundary and ignores application clock skew', async () => {
  const key = randomUUID();
  await store.incrementSecurity(key, 1, 900000);
  // Place a live attempt just before the most recent epoch boundary.
  await ctx.pool.query(
    `UPDATE rate_limit_windows SET events=ARRAY[
    floor(extract(epoch FROM clock_timestamp())*1000/900000)::bigint*900000-1]
    WHERE key=$1`,
    [key]
  );
  const clock = vi.spyOn(Date, 'now').mockReturnValue(0);
  try {
    const result = await second.incrementSecurity(key, 1, 900000);
    expect(result.allowed).toBe(false);
    expect(result.resetMs).toBeGreaterThan(0);
    expect(result.resetMs).toBeLessThanOrEqual(900000);
  } finally {
    clock.mockRestore();
  }
});

it('expires individual attempts at the window edge and keeps the recent failure', async () => {
  const key = randomUUID();
  await store.incrementSecurity(key, 10, 900000);
  await ctx.pool.query(
    `UPDATE rate_limit_windows SET events=ARRAY[
    floor(extract(epoch FROM clock_timestamp())*1000)::bigint-900000,
    floor(extract(epoch FROM clock_timestamp())*1000)::bigint-1000] WHERE key=$1`,
    [key]
  );
  expect(await second.getCurrentCount(key, 900000)).toBe(1);
  expect((await store.incrementSecurity(key, 10, 900000)).remaining).toBe(8);
  expect(await store.getCurrentCount(key, 60000)).toBe(0);
});

it('keeps failure storage bounded while preserving every progressive threshold', async () => {
  const key = randomUUID();
  await Promise.all(Array.from({ length: 60 }, () => store.incrementSecurity(key, 10, 900000)));
  expect(await store.getCurrentCount(key, 900000)).toBe(11);
  expect(
    (
      await ctx.pool.query('SELECT cardinality(events) AS n FROM rate_limit_windows WHERE key=$1', [
        key,
      ])
    ).rows[0].n
  ).toBe(11);
  await ctx.pool.query(
    `UPDATE rate_limit_windows SET events=ARRAY(
    SELECT CASE WHEN ordinality<=6 THEN floor(extract(epoch FROM clock_timestamp())*1000)::bigint-900000
    ELSE t END FROM unnest(events) WITH ORDINALITY e(t,ordinality)) WHERE key=$1`,
    [key]
  );
  expect(await store.getCurrentCount(key, 900000)).toBe(5);
  expect((await second.incrementSecurity(key, 10, 900000)).remaining).toBe(4);
});

it('carries legacy buckets across their old boundary and does not import them twice', async () => {
  const key = randomUUID();
  await ctx.pool.query(
    `INSERT INTO security_rate_limit_counters VALUES
    ($1, floor(extract(epoch FROM clock_timestamp())*1000)::bigint-900010,900000,6,
     clock_timestamp()-interval '20 milliseconds')`,
    [key]
  );
  expect(await store.getCurrentCount(key, 900000)).toBe(6);
  expect(await second.getCurrentCount(key, 900000)).toBe(6);
  expect(
    (await ctx.pool.query('SELECT * FROM security_rate_limit_counters WHERE key=$1', [key]))
      .rowCount
  ).toBe(0);
});

it('keeps truncated history conservative when an active quota increases', async () => {
  const key = randomUUID();
  for (let i = 0; i < 10; i++) await store.incrementSecurity(key, 2, 900000);
  expect((await second.incrementSecurity(key, 8, 900000)).allowed).toBe(false);
  await store.resetSecurity(key);
  expect((await second.incrementSecurity(key, 8, 900000)).remaining).toBe(7);
});

it('serializes a reset behind an uncommitted increment without losing later failures', async () => {
  const key = randomUUID();
  const client = await ctx.pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT * FROM rate_limit_rolling(true,$1,900000,10,true)', [key]);
    let resetDone = false;
    const reset = second.resetSecurity(key).then(() => {
      resetDone = true;
    });
    await vi.waitFor(async () => {
      const waiting = await ctx.pool.query(`SELECT count(*)::int AS n FROM pg_stat_activity
        WHERE wait_event='advisory' AND query LIKE 'SELECT rate_limit_rolling_reset%'`);
      expect(waiting.rows[0].n).toBeGreaterThan(0);
    });
    expect(resetDone).toBe(false);
    await client.query('COMMIT');
    await reset;
    expect(await store.getCurrentCount(key, 900000)).toBe(0);
    expect((await second.incrementSecurity(key, 10, 900000)).remaining).toBe(9);
  } finally {
    await client.query('ROLLBACK');
    client.release();
  }
});

it('cleans expired histories with server time while retaining live quotas', async () => {
  const key = randomUUID();
  const live = randomUUID();
  await store.increment(key, 2, 1000);
  await store.increment(live, 2, 900000);
  await ctx.pool.query('UPDATE rate_limit_windows SET expires_at=0 WHERE key=$1', [key]);
  expect(await store.cleanup()).toBeGreaterThanOrEqual(1);
  expect((await store.increment(live, 2, 900000)).remaining).toBe(0);
});
