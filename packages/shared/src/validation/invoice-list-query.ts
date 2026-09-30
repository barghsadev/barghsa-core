import { parseHistoryQuery } from './history-query.js';

export const CUSTOMER_INVOICE_STATUSES = [
  'Unpaid',
  'PaymentUnderReview',
  'PartiallyFunded',
  'Paid',
  'Overdue',
  'Cancelled',
  'PartiallyRefunded',
  'Refunded',
] as const;
export const INVOICE_LIST_SORTS = ['created_at:desc', 'created_at:asc'] as const;
export const DEFAULT_INVOICE_LIST_SORT = 'created_at:desc';
export interface InvoiceListQuery {
  q: string;
  sort: (typeof INVOICE_LIST_SORTS)[number];
}
export interface NumberRangeValue {
  min?: string | undefined;
  max?: string | undefined;
}

/** Exact non-negative int8 amounts; localized digits never pass through Number. */
export function parseNumberRange(min: unknown, max: unknown): NumberRangeValue | null {
  const parse = (raw: unknown): string | undefined | null => {
    if (raw === undefined || raw === '') return undefined;
    if (typeof raw !== 'string' || raw.length > 32) return null;
    const digits = raw
      .trim()
      .replace(/[۰-۹]/g, (digit) => String(digit.charCodeAt(0) - 0x06f0))
      .replace(/[٠-٩]/g, (digit) => String(digit.charCodeAt(0) - 0x0660));
    if (!/^[0-9]{1,19}$/.test(digits)) return null;
    const amount = BigInt(digits);
    return amount <= 9223372036854775807n ? amount.toString() : null;
  };
  const lower = parse(min),
    upper = parse(max);
  if (
    lower === null ||
    upper === null ||
    (lower !== undefined && upper !== undefined && BigInt(lower) > BigInt(upper))
  )
    return null;
  return { min: lower, max: upper };
}

export function parseInvoiceListQuery(q: unknown, sort: unknown): InvoiceListQuery | null {
  const text = parseHistoryQuery(q, undefined);
  const order = sort === undefined || sort === '' ? DEFAULT_INVOICE_LIST_SORT : sort;
  if (!text || !INVOICE_LIST_SORTS.includes(order as InvoiceListQuery['sort'])) return null;
  return { q: text.q, sort: order as InvoiceListQuery['sort'] };
}
