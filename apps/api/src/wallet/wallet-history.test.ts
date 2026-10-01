import { createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { parseWalletHistoryQuery, readWalletHistory } from './wallet-history.js';

describe('wallet history query boundaries', () => {
  it('accepts existing unfiltered cursor scope hashes', async () => {
    const scope = createHash('sha256')
      .update(JSON.stringify(['profile', null, null, null, null, 'desc']))
      .digest('hex');
    const cursor = Buffer.from(
      JSON.stringify({
        v: 1,
        scope,
        at: '2026-09-01T00:00:00.123456Z',
        id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      })
    ).toString('base64url');
    const client = { query: vi.fn().mockResolvedValue({ rows: [] }) };
    await readWalletHistory(client as never, 'profile', parseWalletHistoryQuery({ cursor }));
    expect(client.query.mock.calls[0]?.[1]).toEqual([
      'profile',
      '2026-09-01T00:00:00.123456Z',
      'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      51,
    ]);
  });
  it('compares date ranges at full precision, including timezone offsets', () => {
    expect(() =>
      parseWalletHistoryQuery({
        from: '2026-09-01T00:00:00.000001Z',
        until: '2026-09-01T00:00:00.000002Z',
      })
    ).not.toThrow();
    expect(() =>
      parseWalletHistoryQuery({
        from: '2026-09-01T14:00:00.000001+14:00',
        until: '2026-09-01T00:00:00.000002Z',
      })
    ).not.toThrow();
    expect(() => parseWalletHistoryQuery({ until: '2026-09-01T00:00:00+23:00' })).toThrow();
    expect(() =>
      parseWalletHistoryQuery({
        from: '2026-09-01T00:00:00.000002Z',
        to: '2026-09-01T00:00:00.000001Z',
      })
    ).toThrow();
    expect(() =>
      parseWalletHistoryQuery({
        from: '2026-09-01T00:00:00.123Z',
        until: '2026-09-01T00:00:00.123000Z',
      })
    ).toThrow();
  });
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

it('adds only the curated receipt projection, using the same scoped page query', async () => {
  const row = {
    id: 'receipt',
    type: 'topup',
    amount: '9007199254740993',
    state: 'Rejected',
    ref_id: null,
    description: null,
    created_at: '2026-09-01T12:00:00.123456Z',
    metadata: {
      channel: 'bank_receipt',
      receipt: { paymentDate: '2026-09-01' },
      staffDecision: {
        decision: 'rejected',
        actorUserId: 'private-staff',
        decidedAt: '2026-09-02T12:00:00Z',
        reason: 'private-note',
        customerVisible: false,
      },
    },
  };
  const client = { query: vi.fn().mockResolvedValue({ rows: [row] }) };
  const result = await readWalletHistory(client as never, 'profile', parseWalletHistoryQuery({}));
  expect(result.transactions[0]?.bankReceipt?.timeline.events.at(-1)).toEqual({
    state: 'rejected',
    occurredAt: '2026-09-02T12:00:00Z',
  });
  expect(result.transactions[0]?.bankReceipt?.rejectionReason).toBeNull();
  expect(JSON.stringify(result)).not.toContain('private-');
  expect(result.transactions[0]?.createdAt).toBe(row.created_at);
  expect(client.query).toHaveBeenCalledTimes(1);
  expect(client.query.mock.calls[0]?.[1]).toEqual(['profile', 51]);
});
