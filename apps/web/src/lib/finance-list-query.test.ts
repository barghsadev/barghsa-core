import { expect, it } from 'vitest';
import {
  decodeFinanceCursor,
  encodeFinanceCursor,
  invoiceListsSearch,
  invoiceLedgerQueryOptions,
  invoiceReceiptQueryOptions,
  pendingReceiptQueryOptions,
  pendingReceiptSearch,
} from './finance-list-query.js';
import { writeListQuery } from '../hooks/useListQuery.js';
const id = '82000000-0000-4000-8000-000000000001';
const stamp = '2026-09-01T00:00:00.123456Z';
const cursor = encodeFinanceCursor({ beforeAt: stamp, beforeId: id });
it.each([
  null,
  {},
  [],
  ['bad', id],
  ['2026-02-30T00:00:00.123456Z', id],
  ['2026-09-01T25:00:00Z', id],
  [stamp, 'invalid'],
  [stamp, id, 'extra'],
  'not JSON',
  'x'.repeat(257),
  ['0000-01-01T00:00:00Z', id],
  ['2026-09-01T00:00:00.1234567Z', id],
])('rejects malformed or invalid finance cursor %j', (value) => {
  expect(decodeFinanceCursor(value)).toBeNull();
});
it.each(['2026-09-01T00:00:00Z', '2026-09-01T00:00:00.1Z', '2026-09-01T00:00:00.123Z', stamp])(
  'retains exact accepted UTC cursor %s',
  (beforeAt) => {
    expect(decodeFinanceCursor(encodeFinanceCursor({ beforeAt, beforeId: id }))).toEqual({
      beforeAt,
      beforeId: id,
    });
  }
);
it('accepts a direct router-decoded pair and preserves microseconds without date rounding', () => {
  expect(invoiceListsSearch({ cursor: [stamp, id] }).cursor).toBe(cursor);
});
it('allowlists filters and legacy invoice deep links while clearing malformed values', () => {
  expect(
    invoiceListsSearch({
      invoiceId: id,
      state: 'Paid',
      profileId: [],
      orderId: 'bad',
      cursor: 'bad',
      receipt_state: 'Submitted',
      admin: true,
    })
  ).toMatchObject({
    invoiceId: id,
    state: 'Paid',
    profileId: undefined,
    orderId: undefined,
    cursor: undefined,
    receipt_state: undefined,
  });
  expect(invoiceListsSearch({ admin: true })).not.toHaveProperty('admin');
  expect(invoiceListsSearch({ order: 'asc' })).not.toHaveProperty('order');
});
it('keeps the independent receipt scope when ledger criteria reset its cursor', () => {
  const raw = invoiceListsSearch({
    state: 'Paid',
    cursor,
    receipt_state: 'Confirmed',
    receipt_invoiceId: id,
    receipt_cursor: cursor,
    receiptHistory: true,
    receipts: true,
  });
  const next = invoiceListsSearch(
    writeListQuery(raw, invoiceLedgerQueryOptions, { filters: { state: 'Unpaid' } })
  );
  expect(next).toMatchObject({
    state: 'Unpaid',
    cursor: undefined,
    receipt_state: 'Confirmed',
    receipt_invoiceId: id,
    receipt_cursor: cursor,
    receipts: 'true',
    receiptHistory: 'true',
  });
});
it('keeps the ledger scope when receipt filters reset only their cursor', () => {
  const raw = invoiceListsSearch({
    state: 'Paid',
    invoiceId: id,
    cursor,
    receipt_state: 'Confirmed',
    receipt_cursor: cursor,
  });
  expect(
    invoiceListsSearch(
      writeListQuery(raw, invoiceReceiptQueryOptions, { filters: { state: 'Rejected' } })
    )
  ).toMatchObject({
    state: 'Paid',
    invoiceId: id,
    cursor,
    receipt_state: 'Rejected',
    receipt_cursor: undefined,
  });
});
it('opens filtered history links and preserves explicit collapse across subsequent updates', () => {
  expect(invoiceListsSearch({ receipt_state: 'Confirmed' })).toMatchObject({
    receiptHistory: 'true',
    receipts: 'true',
  });
  const collapsed = invoiceListsSearch({
    receipt_state: 'Confirmed',
    receipts: false,
    receiptHistory: false,
  });
  expect(
    invoiceListsSearch(
      writeListQuery(collapsed, invoiceLedgerQueryOptions, { filters: { state: 'Paid' } })
    )
  ).toMatchObject({ receipts: 'false', receiptHistory: 'false' });
});

it('keeps pending receipt search/order/cursor separate from ledger and reviewed receipt scope', () => {
  const raw = invoiceListsSearch({
    state: 'Paid',
    cursor,
    receipt_state: 'Rejected',
    receipt_cursor: cursor,
    queue_q: '  بانک_%  ',
    queue_order: 'desc',
    queue_cursor: [stamp, id],
  });
  expect(raw).toMatchObject({
    queue_q: 'بانک_%',
    queue_order: 'desc',
    queue_cursor: cursor,
    receipts: 'true',
    state: 'Paid',
    cursor,
    receipt_state: 'Rejected',
    receipt_cursor: cursor,
  });
  const next = invoiceListsSearch(
    writeListQuery(raw, pendingReceiptQueryOptions, { search: 'next' })
  );
  expect(next).toMatchObject({
    queue_q: 'next',
    queue_order: 'desc',
    queue_cursor: undefined,
    state: 'Paid',
    cursor,
    receipt_state: 'Rejected',
    receipt_cursor: cursor,
  });
  expect(
    invoiceListsSearch(
      writeListQuery(raw, invoiceReceiptQueryOptions, { filters: { state: 'Confirmed' } })
    )
  ).toMatchObject({ queue_q: 'بانک_%', queue_cursor: cursor, receipt_cursor: undefined });
});
it('drops malformed queue pagination and private parameters while retaining supported selections', () => {
  expect(
    pendingReceiptSearch({
      queue_q: 'Bank',
      queue_order: 'desc',
      queue_cursor: 'bad',
      key: 'sealed',
      limit: 5000,
    })
  ).toEqual({ queue_q: 'Bank', queue_order: 'desc', queue_cursor: undefined });
  expect(
    pendingReceiptSearch({
      queue_q: 'x'.repeat(121),
      queue_order: 'invalid',
      queue_cursor: [stamp, 'invalid'],
    })
  ).toEqual({ queue_q: undefined, queue_order: undefined, queue_cursor: undefined });
});

it('preserves exact history amounts and independent queue/ledger scopes through history updates', () => {
  const raw = invoiceListsSearch({
    state: 'Paid',
    cursor,
    queue_q: 'pending',
    queue_cursor: cursor,
    receipt_q: '  بانک_%  ',
    receipt_order: 'asc',
    receipt_cursor: cursor,
    receipt_from: '2026-09-01T00:00:00.000Z',
    receipt_to: '2026-10-01T00:00:00.000Z',
    receipt_min: '۹۰۰۷۱۹۹۲۵۴۷۴۰۹۹۳',
    receipt_max: '9223372036854775807',
  });
  expect(raw).toMatchObject({
    receipt_q: 'بانک_%',
    receipt_order: 'asc',
    receipt_min: '9007199254740993',
    receipt_max: '9223372036854775807',
    receipts: 'true',
    receiptHistory: 'true',
  });
  expect(
    invoiceListsSearch(writeListQuery(raw, invoiceReceiptQueryOptions, { search: 'next' }))
  ).toMatchObject({
    state: 'Paid',
    cursor,
    queue_q: 'pending',
    queue_cursor: cursor,
    receipt_q: 'next',
    receipt_order: 'asc',
    receipt_cursor: undefined,
    receipt_min: '9007199254740993',
    receipt_max: '9223372036854775807',
  });
});
it('drops invalid history ranges and rounded numeric URL bounds instead of guessing an amount', () => {
  expect(
    invoiceListsSearch({
      receipt_min: Number('9007199254740993'),
      receipt_max: '1',
      receipt_from: '2026-02-30T00:00:00.000Z',
      receipt_to: '2026-03-01T00:00:00.000Z',
    })
  ).toMatchObject({
    receipt_min: undefined,
    receipt_max: undefined,
    receipt_from: undefined,
    receipt_to: undefined,
  });
  expect(
    invoiceListsSearch({
      receipt_min: '2',
      receipt_max: '1',
      receipt_from: '2026-10-01T00:00:00.000Z',
      receipt_to: '2026-09-01T00:00:00.000Z',
    })
  ).toMatchObject({
    receipt_min: undefined,
    receipt_max: undefined,
    receipt_from: undefined,
    receipt_to: undefined,
  });
});
