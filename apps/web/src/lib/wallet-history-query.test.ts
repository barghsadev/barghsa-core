import { describe, expect, it } from 'vitest';
import { parseListQuery, writeListQuery } from './list-query.js';
import {
  walletHistoryQueryOptions as options,
  walletHistorySearch,
} from './wallet-history-query.js';

describe('wallet history route search', () => {
  it('preserves exact bounds and payment return context without accepting other route keys', () => {
    const raw = {
      paymentOrderId: 'order-123',
      paymentAuthority: 'authority-123',
      returnInvoiceId: '11111111-1111-4111-8111-111111111111',
      history_q: '  BANK_%\\  ',
      history_order: 'asc',
      history_state: 'Completed',
      history_min: '۹۰۰۷۱۹۹۲۵۴۷۴۰۹۹۳',
      history_max: '9007199254740993',
      history_from: '2026-09-01T00:00:00.000Z',
      history_to: '2026-09-02T00:00:00.000Z',
      history_cursor: 'opaque-page',
      unexpected: 'discard',
    };
    const normalized = walletHistorySearch(raw);
    expect(normalized).toMatchObject({
      paymentOrderId: raw.paymentOrderId,
      paymentAuthority: raw.paymentAuthority,
      returnInvoiceId: raw.returnInvoiceId,
      history_q: 'BANK_%\\',
      history_min: '9007199254740993',
      history_max: raw.history_max,
      history_cursor: raw.history_cursor,
      history_order: 'asc',
    });
    expect(normalized).not.toHaveProperty('unexpected');
    expect(parseListQuery(normalized, options).filters.min).toBe('9007199254740993');
  });
  it.each([
    { history_min: Number('9007199254740993'), history_max: '9007199254740993' },
    { history_min: '-1', history_max: '10' },
    { history_min: '20', history_max: '10' },
    { history_min: '9223372036854775808' },
  ])('drops invalid amount pairs: %j', (raw) => {
    const search = walletHistorySearch(raw);
    expect(search.history_min).toBeUndefined();
    expect(search.history_max).toBeUndefined();
  });
  it.each([
    { history_from: '2026-09-02T00:00:00.000Z', history_to: '2026-09-01T00:00:00.000Z' },
    { history_from: '2026-02-30T00:00:00.000Z' },
    { history_from: '2026-09-01' },
  ])('drops invalid date pairs: %j', (raw) => {
    const search = walletHistorySearch(raw);
    expect(search.history_from).toBeUndefined();
    expect(search.history_to).toBeUndefined();
  });
  it.each(['bad*cursor', 'x'.repeat(2049), 123])('rejects unsafe continuation: %j', (cursor) => {
    expect(walletHistorySearch({ history_cursor: cursor }).history_cursor).toBeUndefined();
  });
  it('resets the cursor on criteria changes while preserving payment context and order', () => {
    const raw = {
      paymentOrderId: 'order',
      paymentAuthority: 'auth',
      history_cursor: 'opaque',
      history_order: 'asc',
    };
    const next = walletHistorySearch(
      writeListQuery(raw, options, { search: 'receipt', filters: { min: '9007199254740993' } })
    );
    expect(next).toMatchObject({
      paymentOrderId: 'order',
      paymentAuthority: 'auth',
      history_q: 'receipt',
      history_order: 'asc',
      history_min: '9007199254740993',
    });
    expect(next.history_cursor).toBeUndefined();
  });
});
