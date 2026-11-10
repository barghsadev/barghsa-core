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

it('rolls back the candidate and records the SQLSTATE category without provider details', async () => {
  const id = '11111111-1111-7111-8111-111111111111';
  const query = vi
    .fn()
    .mockResolvedValueOnce({ rows: [] })
    .mockRejectedValueOnce(
      Object.assign(new Error('fixture private merchant and callback details'), { code: '55P03' })
    )
    .mockResolvedValueOnce({ rows: [] });
  const release = vi.fn();
  const pool = {
    query: vi.fn().mockResolvedValue({ rows: [{ id, kind: 'callback', identity: id }] }),
    connect: vi.fn().mockResolvedValue({ query, release }),
  } as unknown as Pool;

  expect(await reconcileProviderTransactions({ pool })).toMatchObject({
    scanned: 1,
    reported: 0,
    errors: [`${id}: lock unavailable`],
  });
  expect(query.mock.calls.at(-1)).toEqual(['ROLLBACK']);
  expect(release).toHaveBeenCalledOnce();
});
