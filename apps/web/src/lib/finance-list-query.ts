import { parseDateRangeFilter } from '@barghsa/shared/validation';
import { isInvoiceUuid } from './due-at-override.js';
import { listChoice, writeListQuery, type ListQueryOptions } from '../hooks/useListQuery.js';

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
  filters: { state: listChoice(['Confirmed', 'Rejected']), invoiceId: uuid },
};
export function invoiceListsSearch(raw: Record<string, unknown>) {
  const cursors = {
    ...raw,
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
  ];
  const result = Object.fromEntries(own.map((key) => [key, normalized[key]]));
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
    !!(result.receipt_state || result.receipt_invoiceId || result.receipt_cursor)
  );
  result.receipts = flag(raw.receipts, result.receiptHistory === 'true');
  return result;
}
