import { parseDateRangeFilter, parseNumberRange } from '@barghsa/shared/validation';
import { listChoice, writeListQuery, type ListQueryOptions } from './list-query.js';
export const walletHistoryTypes = [
  'topup',
  'payment',
  'refund',
  'reservation',
  'release',
  'reversal',
  'compensating',
];
export const walletHistoryStates = [
  'Pending',
  'Reserved',
  'Completed',
  'Failed',
  'Rejected',
  'Released',
  'Reversed',
];
export const walletHistoryQueryOptions: ListQueryOptions = {
  prefix: 'history_',
  searchLimit: 120,
  sortFields: ['submitted_at'],
  defaultSort: 'submitted_at',
  defaultOrder: 'desc',
  pageSizes: [25],
  defaultPageSize: 25,
  pagination: 'cursor',
  filters: {
    type: listChoice(walletHistoryTypes),
    state: listChoice(walletHistoryStates),
    from: (value) => parseDateRangeFilter(value, undefined)?.from ?? '',
    to: (value) => parseDateRangeFilter(undefined, value)?.to ?? '',
    min: (value) => parseNumberRange(value, undefined)?.min ?? '',
    max: (value) => parseNumberRange(undefined, value)?.max ?? '',
  },
};
export function walletHistorySearch(raw: Record<string, unknown>) {
  const dates = parseDateRangeFilter(raw.history_from, raw.history_to) ?? {};
  const amounts = parseNumberRange(raw.history_min, raw.history_max) ?? {};
  const cursor = raw.history_cursor;
  const normalized = writeListQuery(
    {
      ...raw,
      history_from: dates.from,
      history_to: dates.to,
      history_min: amounts.min,
      history_max: amounts.max,
      history_cursor:
        typeof cursor === 'string' && /^[A-Za-z0-9_-]{1,2048}$/.test(cursor) ? cursor : undefined,
    },
    walletHistoryQueryOptions,
    {}
  );
  // Payment return values belong to the existing route component's validation.
  return Object.fromEntries(
    [
      'paymentOrderId',
      'paymentAuthority',
      'returnInvoiceId',
      'history_q',
      'history_order',
      'history_type',
      'history_state',
      'history_from',
      'history_to',
      'history_min',
      'history_max',
      'history_cursor',
    ].map((key) => [key, normalized[key]])
  );
}
