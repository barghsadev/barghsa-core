import { randomBytes } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Pool } from 'pg';
import { afterEach, expect, it, vi } from 'vitest';
import {
  collectMonthlyCostMetrics,
  costCategories,
  serveMonthlyCostMetrics,
} from './monthly-costs.js';

const asOf = '2026-10-20T00:00:00.000Z';
const now = new Date('2026-11-02T00:00:00.000Z');
const amount = 10_000_000;

function fixture() {
  return {
    month: '2026-10',
    asOf,
    currency: 'USD',
    costs: Object.keys(costCategories).map((category) => ({
      category,
      provider: 'billing-fixture',
      ...(category === 'ai' ? { model: 'test/model:variant' } : {}),
      amountMicros: amount,
    })),
    budgets: Object.fromEntries(Object.keys(costCategories).map((category) => [category, amount])),
  };
}

function usage(profiles: number, orders: number) {
  const query = vi.fn().mockResolvedValue({ rows: [{ profiles, orders }] });
  return { pool: { query } as Pick<Pool, 'query'>, query };
}

afterEach(() => vi.unstubAllEnvs());

it('reports all eight categories, preserves source and AI model scope, and computes both unit costs', async () => {
  const data = fixture();
  data.costs.push({ category: 'compute', provider: 'another-source', amountMicros: 20_000_000 });
  const { pool, query } = usage(25, 5);
  const metrics = await collectMonthlyCostMetrics(pool, data, now);
  expect(query).toHaveBeenCalledExactlyOnceWith(expect.any(String), [
    new Date('2026-10-01T00:00:00.000Z'),
    new Date(asOf),
  ]);
  const allocations = metrics
    .split('\n')
    .filter((line) => line.startsWith('barghsa_monthly_cost_amount{'));
  expect(allocations).toHaveLength(9);
  expect(allocations).toContain(
    'barghsa_monthly_cost_amount{month="2026-10",currency="USD",category="ai",provider="billing-fixture",model="test/model:variant"} 10'
  );
  expect(metrics).toContain(
    'barghsa_monthly_cost_per_unit{month="2026-10",currency="USD",unit="active_profile"} 4\n'
  );
  expect(metrics).toContain(
    'barghsa_monthly_cost_per_unit{month="2026-10",currency="USD",unit="order"} 20\n'
  );
  expect(metrics).toContain(
    'barghsa_monthly_cost_variance_exceeded{month="2026-10",currency="USD",category="compute"} 1\n'
  );
});

it('uses an exact greater-than threshold, counts zero budgets, and alerts on underspend only at close', async () => {
  const data = fixture();
  data.costs[0]!.amountMicros = 12_000_000;
  data.costs[1]!.amountMicros = 12_000_001;
  data.costs[2]!.amountMicros = 7_999_999;
  data.costs[3]!.amountMicros = 0;
  data.budgets['storage_egress'] = 0;
  data.budgets['redis'] = 0;
  const { pool } = usage(0, 0);
  const open = await collectMonthlyCostMetrics(pool, data, now);
  const expected = (category: string, value: number) =>
    `barghsa_monthly_cost_variance_exceeded{month="2026-10",currency="USD",category="${category}"} ${value}\n`;
  expect(open).toContain(expected('compute', 0));
  expect(open).toContain(expected('postgres', 1));
  expect(open).toContain(expected('object_storage', 0));
  expect(open).toContain(expected('storage_egress', 0));
  expect(open).toContain(expected('redis', 1));
  expect(open).not.toContain('barghsa_monthly_cost_per_unit{');
  const closed = await collectMonthlyCostMetrics(
    pool,
    { ...data, asOf: '2026-11-01T00:00:00.000Z' },
    now
  );
  expect(closed).toContain(expected('object_storage', 1));
});

it('rejects incomplete, duplicate, stale, future and malformed billing data before querying usage', async () => {
  const data = fixture();
  const { pool, query } = usage(2, 3);
  for (const invalid of [
    { ...data, costs: data.costs.slice(1) },
    { ...data, costs: [...data.costs, data.costs[0]] },
    { ...data, budgets: { ...data.budgets, other: amount } },
    { ...data, budgets: { ...data.budgets, ai: -1 } },
    { ...data, budgets: { ...data.budgets, ai: Number.MAX_SAFE_INTEGER + 1 } },
    { ...data, asOf: '2026-11-01T00:00:00.001Z' },
    { ...data, asOf: '2026-10-01T00:00:00.000Z' },
    { ...data, month: '2026-09', asOf: '2026-09-14T00:00:00.000Z' },
    { ...data, month: '2026-11', asOf: '2026-11-02T00:00:00.001Z' },
    { ...data, costs: data.costs.map((entry) => ({ ...entry, provider: 'invalid\nlabel' })) },
  ]) {
    await expect(collectMonthlyCostMetrics(pool, invalid, now)).rejects.toThrow();
  }
  expect(query).not.toHaveBeenCalled();
});

it('requires the dedicated scrape token and refuses missing or oversized reports without exposing data', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'barghsa-billing-test-'));
  const snapshotPath = join(directory, 'monthly-costs.json');
  const tokenPath = join(directory, 'scrape-token');
  const token = randomBytes(32).toString('hex');
  const { pool, query } = usage(2, 3);
  const server = createServer((req, res) => void serveMonthlyCostMetrics(req, res, pool));
  try {
    vi.stubEnv('OPS_MONTHLY_COST_SNAPSHOT_FILE', snapshotPath);
    vi.stubEnv('OPS_MONTHLY_COST_SCRAPE_TOKEN_FILE', tokenPath);
    await writeFile(tokenPath, token + '\n', { mode: 0o600 });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Missing billing fixture address');
    const url = `http://127.0.0.1:${address.port}/operations/monthly-costs`;
    const headers = { Authorization: `Bearer ${token}` };
    expect((await fetch(url)).status).toBe(401);
    expect((await fetch(url, { method: 'POST', headers })).status).toBe(404);
    expect((await fetch(url, { headers })).status).toBe(503);
    await writeFile(snapshotPath, 'x'.repeat(65_537), { mode: 0o600 });
    const oversized = await fetch(url, { headers });
    expect(oversized.status).toBe(503);
    expect(await oversized.text()).toBe('');
    expect(query).not.toHaveBeenCalled();
    const reference = new Date(Date.now() - 86_400_000);
    reference.setUTCHours(12, 0, 0, 0);
    const data = {
      ...fixture(),
      month: reference.toISOString().slice(0, 7),
      asOf: reference.toISOString(),
    };
    await writeFile(snapshotPath, JSON.stringify(data), { mode: 0o600 });
    const allowed = await fetch(url, { headers });
    expect(allowed.status).toBe(200);
    expect(allowed.headers.get('cache-control')).toBe('no-store');
    const body = await allowed.text();
    expect(body).toContain('barghsa_monthly_cost_amount{');
    expect(body).not.toContain(token);
    expect(query).toHaveBeenCalledOnce();
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await rm(directory, { recursive: true, force: true });
  }
});
