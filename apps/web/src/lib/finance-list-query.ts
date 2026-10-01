import { parseDateRangeFilter, parseNumberRange } from '@barghsa/shared/validation';
import { isInvoiceUuid } from './due-at-override.js';
import { listChoice, writeListQuery, type ListQueryOptions } from './list-query.js';

export interface FinanceCursor {
  beforeAt: string;
  beforeId: string;
}
function validCursorTime(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?Z$/.test(value)) return false;
  const canonical = value.includes('.')
    ? value.replace(
        /\.(\d{1,6})Z$/,
        (_, digits: string) => `.${digits.padEnd(3, '0').slice(0, 3)}Z`
      )
    : value.replace(/Z$/, '.000Z');
  return !!parseDateRangeFilter(canonical, undefined)?.from;
}
export function decodeFinanceCursor(value: unknown): FinanceCursor | null {
  if (typeof value !== 'string' && !Array.isArray(value)) return null;
  if (typeof value === 'string' && value.length > 256) return null;
  try {
    const pair: unknown = typeof value === 'string' ? JSON.parse(value) : value;
    if (!Array.isArray(pair) || pair.length !== 2) return null;
    const [beforeAt, beforeId] = pair;
    if (
      typeof beforeAt !== 'string' ||
      typeof beforeId !== 'string' ||
      !isInvoiceUuid(beforeId) ||
      !validCursorTime(beforeAt)
    )
      return null;
    return { beforeAt, beforeId };
  } catch {
    return null;
  }
}
export function encodeFinanceCursor(value: FinanceCursor | null | undefined): string {
  if (!value) return '';
  const encoded = JSON.stringify([value.beforeAt, value.beforeId]);
  return decodeFinanceCursor(encoded) ? encoded : '';
}
const uuid = (value: unknown) => (typeof value === 'string' && isInvoiceUuid(value) ? value : '');
export const invoiceLedgerQueryOptions: ListQueryOptions = {
  searchLimit: 0,
  filters: {
    state: listChoice([
      'Draft',
      'Unpaid',
      'PaymentUnderReview',
      'PartiallyFunded',
      'Paid',
      'Overdue',
      'Cancelled',
      'PartiallyRefunded',
      'Refunded',
    ]),
    invoiceId: uuid,
    profileId: uuid,
    orderId: uuid,
  },
  sortFields: [],
  defaultSort: '',
  pageSizes: [20],
  defaultPageSize: 20,
  pagination: 'cursor',
};
export const invoiceReceiptQueryOptions: ListQueryOptions = {
  ...invoiceLedgerQueryOptions,
  prefix: 'receipt_',
  searchLimit: 120,
  sortFields: ['submitted_at'],
  defaultSort: 'submitted_at',
  pageSizes: [25],
  defaultPageSize: 25,
  filters: {
    state: listChoice(['Confirmed', 'Rejected']),
    invoiceId: uuid,
    from: (value) => parseDateRangeFilter(value, undefined)?.from ?? '',
    to: (value) => parseDateRangeFilter(undefined, value)?.to ?? '',
    min: (value) => parseNumberRange(value, undefined)?.min ?? '',
    max: (value) => parseNumberRange(undefined, value)?.max ?? '',
  },
};
export const pendingReceiptQueryOptions: ListQueryOptions = {
  prefix: 'queue_',
  searchLimit: 120,
  filters: {},
  sortFields: ['submitted_at'],
  defaultSort: 'submitted_at',
  defaultOrder: 'asc',
  pageSizes: [25],
  defaultPageSize: 25,
  pagination: 'cursor',
};
export function pendingReceiptSearch(raw: Record<string, unknown>) {
  const normalized = writeListQuery(
    { ...raw, queue_cursor: encodeFinanceCursor(decodeFinanceCursor(raw.queue_cursor)) },
    pendingReceiptQueryOptions,
    {}
  );
  return Object.fromEntries(
    ['queue_q', 'queue_order', 'queue_cursor'].map((key) => [key, normalized[key]])
  );
}
export function invoiceListsSearch(raw: Record<string, unknown>) {
  const dates = parseDateRangeFilter(raw.receipt_from, raw.receipt_to) ?? {};
  const amounts = parseNumberRange(raw.receipt_min, raw.receipt_max) ?? {};
  const cursors = {
    ...raw,
    receipt_from: dates.from,
    receipt_to: dates.to,
    receipt_min: amounts.min,
    receipt_max: amounts.max,
    cursor: encodeFinanceCursor(decodeFinanceCursor(raw.cursor)),
    receipt_cursor: encodeFinanceCursor(decodeFinanceCursor(raw.receipt_cursor)),
  };
  const normalized = writeListQuery(
    writeListQuery(cursors, invoiceLedgerQueryOptions, {}),
    invoiceReceiptQueryOptions,
    {}
  );
  const own = [
    'state',
    'invoiceId',
    'profileId',
    'orderId',
    'cursor',
    'receipt_state',
    'receipt_invoiceId',
    'receipt_cursor',
    'receipt_q',
    'receipt_order',
    'receipt_from',
    'receipt_to',
    'receipt_min',
    'receipt_max',
  ];
  const result = {
    ...Object.fromEntries(own.map((key) => [key, normalized[key]])),
    ...pendingReceiptSearch(raw),
  };
  const flag = (value: unknown, fallback: boolean) =>
    value === true || value === 'true'
      ? 'true'
      : value === false || value === 'false'
        ? 'false'
        : fallback
          ? 'true'
          : undefined;
  result.receiptHistory = flag(
    raw.receiptHistory,
    !!(
      result.receipt_state ||
      result.receipt_invoiceId ||
      result.receipt_cursor ||
      result.receipt_q ||
      result.receipt_order ||
      result.receipt_from ||
      result.receipt_to ||
      result.receipt_min ||
      result.receipt_max
    )
  );
  result.receipts = flag(
    raw.receipts,
    result.receiptHistory === 'true' ||
      !!(result.queue_q || result.queue_order || result.queue_cursor)
  );
  return result;
}
