import { describe, expect, it, vi } from 'vitest';
import { parseWalletHistoryQuery, readWalletHistory } from './wallet-history.js';

describe('wallet history query boundaries', () => {
  it.each([
    '*',
    'broken',
    Buffer.from('{}').toString('base64url'),
    Buffer.from(
      JSON.stringify({
        v: 1,
        scope: 'wrong',
        at: '2026-09-01T00:00:00Z',
        id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      })
    ).toString('base64url'),
  ])('rejects malformed cursors before querying: %s', async (cursor) => {
    const client = { query: vi.fn() };
    await expect(async () =>
      readWalletHistory(client as never, 'profile', parseWalletHistoryQuery({ cursor }))
    ).rejects.toMatchObject({ status: 400 });
    expect(client.query).not.toHaveBeenCalled();
  });
  it('returns an empty terminal page without exposing internal ledger fields', async () => {
    const client = { query: vi.fn().mockResolvedValue({ rows: [] }) };
    expect(
      await readWalletHistory(client as never, 'profile', parseWalletHistoryQuery({}))
    ).toEqual({ transactions: [], nextCursor: null });
  });
});
