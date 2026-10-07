import { expect, it, vi } from 'vitest';
import type { Pool } from 'pg';
import { reconcileProviderTransactions } from './provider-reconciliation-scanner';

it.each([0, 1001, 1.5, Number.NaN, Number.POSITIVE_INFINITY, Number.MAX_SAFE_INTEGER + 1])(
  'rejects invalid batch size %s before database access',
  async (batchSize) => {
    const query = vi.fn(),
      pool = { query } as unknown as Pool;
    await expect(reconcileProviderTransactions({ pool, batchSize })).rejects.toThrow('batch size');
    expect(query).not.toHaveBeenCalled();
  }
);
it.each([{ staleMs: 0 }, { ttlMs: 999 }, { now: new Date('invalid') }])(
  'rejects invalid clock configuration %j before database access',
  async (config) => {
    const query = vi.fn(),
      pool = { query } as unknown as Pool;
    await expect(reconcileProviderTransactions({ pool, ...config })).rejects.toThrow('clock');
    expect(query).not.toHaveBeenCalled();
  }
);
