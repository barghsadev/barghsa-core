import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import { createDbPool, dbHealth } from './index.js';
import type { Pool } from 'pg';
let pool: Pool;
beforeAll(() => {
  const databaseUrl = process.env.TEST_DATABASE_URL;
  if (!databaseUrl) throw new Error('PostgreSQL setup did not run');
  pool = createDbPool({
    databaseUrl,
    poolMax: 1,
    poolMin: 0,
    connectionTimeoutMillis: 15000,
  });
});
afterAll(async () => {
  await pool.end();
});
it('reports healthy PostgreSQL with actual pool statistics', async () => {
  const result = await dbHealth();
  expect(result).toMatchObject({
    ok: true,
    poolStats: { totalCount: 1, idleCount: 1, waitingCount: 0 },
  });
});
it('does not queue health work behind an exhausted application pool', async () => {
  const held = await pool.connect();
  try {
    expect((await dbHealth()).ok).toBe(false);
    expect(pool.waitingCount).toBe(0);
  } finally {
    held.release();
  }
}, 10000);

it('cancels a stalled probe and shares its deadline across concurrent callers', async () => {
  const client = await pool.connect();
  const original = client.query.bind(client);
  let probes = 0;
  const query = vi.spyOn(client, 'query').mockImplementation(((text: string) => {
    if (text === 'SELECT 1') {
      probes++;
      return original('SELECT pg_sleep(10)');
    }
    return original(text);
  }) as typeof client.query);
  client.release();
  try {
    const results = await Promise.all(Array.from({ length: 20 }, () => dbHealth()));
    expect(results.every((result) => !result.ok)).toBe(true);
    expect(probes).toBe(1);
    expect(pool.waitingCount).toBe(0);
    await vi.waitFor(() => expect(pool.idleCount).toBe(1), { timeout: 2000 });
  } finally {
    query.mockRestore();
  }
  expect((await dbHealth()).ok).toBe(true);
}, 15000);

it('releases a late checkout without executing an expired probe', async () => {
  const original = pool.connect.bind(pool);
  const client = await original();
  const query = vi.spyOn(client, 'query');
  let releaseGate!: () => void;
  const gate = new Promise<void>((resolve) => {
    releaseGate = resolve;
  });
  const connect = vi.spyOn(pool, 'connect').mockImplementation((async () => {
    await gate;
    return client;
  }) as typeof pool.connect);
  // Let the test exercise acquisition delay rather than the exhausted-pool fast path.
  const max = pool.options.max;
  pool.options.max = 2;
  try {
    expect((await dbHealth()).ok).toBe(false);
    expect((await dbHealth()).ok).toBe(false);
    expect(connect).toHaveBeenCalledTimes(1);
    releaseGate();
    await vi.waitFor(() => expect(pool.idleCount).toBe(1));
    expect(query).not.toHaveBeenCalled();
  } finally {
    releaseGate();
    pool.options.max = max;
    connect.mockRestore();
    query.mockRestore();
  }
  expect((await dbHealth()).ok).toBe(true);
}, 15000);
