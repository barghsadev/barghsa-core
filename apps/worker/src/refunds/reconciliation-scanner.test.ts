import { it, expect, vi } from 'vitest';
import type { Pool } from 'pg';
import { reconcileRefunds } from './reconciliation-scanner';
it.each([0, 1001, 1.5, Number.NaN, Number.POSITIVE_INFINITY, Number.MAX_SAFE_INTEGER + 1])(
  'rejects invalid batch size %s before database access',
  async (batchSize) => {
    const query = vi.fn(),
      pool = { query } as unknown as Pool;
    await expect(reconcileRefunds({ pool, batchSize })).rejects.toThrow('batch size');
    expect(query).not.toHaveBeenCalled();
  }
);
it('continues after a failed connection and commits only the next candidate report', async () => {
  const query = vi.fn(async (sql: string) => {
      if (sql.startsWith('SELECT id FROM invoices')) return { rows: [{ id: 'good' }] };
      if (sql.startsWith('SELECT s.*'))
        return {
          rows: [
            {
              id: 'good',
              profile_id: 'profile',
              adjustment_kind: null,
              paid_amount: '100',
              refunded_amount: '0',
              completed: '0',
              reserved: '1',
              invalid_count: '1',
              invalid_ids: ['refund'],
              legacy_completed_count: '0',
            },
          ],
        };
      return { rows: [] };
    }),
    release = vi.fn(),
    connect = vi
      .fn()
      .mockRejectedValueOnce(new Error('fixture connection unavailable'))
      .mockResolvedValue({ query, release });
  const pool = {
    query: vi
      .fn()
      .mockResolvedValueOnce({ rows: [{ id: 'bad' }, { id: 'good' }] })
      .mockResolvedValueOnce({ rows: [] }),
    connect,
  } as unknown as Pool;
  const result = await reconcileRefunds({ pool });
  expect(result).toMatchObject({ reported: 1, errors: ['bad: fixture connection unavailable'] });
  expect(
    query.mock.calls.filter(([sql]) => sql.startsWith('INSERT INTO reconciliation_exceptions'))
  ).toHaveLength(1);
  expect(query.mock.calls.some(([sql]) => sql === 'COMMIT')).toBe(true);
  expect(release).toHaveBeenCalledOnce();
});
