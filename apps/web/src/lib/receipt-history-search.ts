import {
  BANK_RECEIPT_STATUSES,
  parseStatusFilter,
  parseHistoryQuery,
  DEFAULT_HISTORY_SORT,
  parseDateRangeFilter,
  parseNumberRange,
} from '@barghsa/shared/validation';

export function receiptHistorySearch(search: Record<string, unknown>) {
  const query = parseHistoryQuery(search.q, search.sort) ?? { q: '', sort: DEFAULT_HISTORY_SORT };
  return {
    statuses:
      (parseStatusFilter(search.statuses ?? search.state, BANK_RECEIPT_STATUSES) ?? []).join(',') ||
      undefined,
    q: query.q || undefined,
    sort: query.sort === DEFAULT_HISTORY_SORT ? undefined : query.sort,
    ...(parseDateRangeFilter(search.from, search.to) ?? { from: undefined, to: undefined }),
    ...(parseNumberRange(search.min, search.max) ?? { min: undefined, max: undefined }),
  };
}

export type ReceiptHistorySearch = ReturnType<typeof receiptHistorySearch>;
