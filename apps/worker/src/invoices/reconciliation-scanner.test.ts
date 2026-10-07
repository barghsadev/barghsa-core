import { expect, it, vi } from 'vitest';
import type { Pool } from 'pg';
import { reconcileInvoicePayments } from './reconciliation-scanner.js';

const id = '11111111-1111-7111-8111-111111111111';
const snapshot = {
  id,
  profile_id: id,
  paid_amount: '100',
  receipt_gross: '0',
  receipt_excess: '0',
  wallet_paid: '0',
  invalid_receipt_credits: '0',
  invalid_wallet_payments: '0',
};
function fixture({ locked = true, current = snapshot, existing = false, failInsert = false } = {}) {
  const query = vi.fn(async (sql: string, params?: unknown[]) => {
    if (sql.startsWith('SELECT id FROM invoices')) return { rows: locked ? [{ id }] : [] };
    if (sql.startsWith('WITH target'))
      return { rows: [{ ...current, id: String(params?.[0] ?? current.id) }] };
    if (sql.startsWith('SELECT id FROM reconciliation_exceptions'))
      return { rows: existing ? [{ id }] : [] };
    if (sql.startsWith('INSERT INTO reconciliation_exceptions') && failInsert)
      throw new Error('fixture insert failed');
    return { rows: [] };
  });
  const release = vi.fn();
  const pool = {
    query: vi.fn().mockResolvedValue({ rows: [{ id }] }),
    connect: vi.fn().mockResolvedValue({ query, release }),
  };
  return { pool: pool as unknown as Pool, raw: pool, query, release };
}
it('recomputes a candidate fixed before its invoice lock without opening an incident', async () => {
  const f = fixture({ current: { ...snapshot, wallet_paid: '100' } });
  expect(await reconcileInvoicePayments({ pool: f.pool })).toEqual({
    scanned: 1,
    reported: 0,
    skipped: 1,
    truncated: false,
    errors: [],
  });
  expect(f.query.mock.calls.some(([sql]) => sql.startsWith('INSERT'))).toBe(false);
  expect(f.query.mock.calls.at(-1)).toEqual(['ROLLBACK']);
  expect(f.release).toHaveBeenCalledOnce();
});
it('does not report a candidate claimed or deleted before its lock', async () => {
  const f = fixture({ locked: false });
  expect((await reconcileInvoicePayments({ pool: f.pool })).skipped).toBe(1);
  expect(f.query.mock.calls.some(([sql]) => sql.startsWith('WITH target'))).toBe(false);
  expect(f.release).toHaveBeenCalledOnce();
});
it('checks active incident identity again after the invoice lock', async () => {
  const f = fixture({ existing: true });
  expect((await reconcileInvoicePayments({ pool: f.pool })).reported).toBe(0);
  expect(f.query.mock.calls.some(([sql]) => sql.startsWith('INSERT'))).toBe(false);
});
it('rolls back an insert failure, reports it and releases the client', async () => {
  const f = fixture({ failInsert: true });
  const result = await reconcileInvoicePayments({ pool: f.pool });
  expect(result.reported).toBe(0);
  expect(result.errors).toEqual([`${id}: fixture insert failed`]);
  expect(f.query.mock.calls.at(-1)).toEqual(['ROLLBACK']);
  expect(f.release).toHaveBeenCalledOnce();
});
it('records connection failure for one candidate and continues the remaining candidates', async () => {
  const f = fixture();
  f.raw.query.mockResolvedValue({ rows: [{ id }, { id: '22222222-2222-7222-8222-222222222222' }] });
  f.raw.connect.mockRejectedValueOnce(new Error('fixture connection failed'));
  const result = await reconcileInvoicePayments({ pool: f.pool });
  expect(result.reported).toBe(1);
  expect(result.errors).toEqual([`${id}: fixture connection failed`]);
  const inserted = f.query.mock.calls.find(([sql]) => sql.startsWith('INSERT'));
  expect(JSON.parse(String(inserted?.[1]?.[1])).invoiceId).toBe(
    '22222222-2222-7222-8222-222222222222'
  );
  expect(f.release).toHaveBeenCalledOnce();
});
it.each([0, -1, 1001, NaN, Infinity, 1.5])(
  'rejects invalid bounded size %s before querying',
  async (batchSize) => {
    const f = fixture();
    await expect(reconcileInvoicePayments({ pool: f.pool, batchSize })).rejects.toBeInstanceOf(
      RangeError
    );
    expect(f.raw.query).not.toHaveBeenCalled();
  }
);
