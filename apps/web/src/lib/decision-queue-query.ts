import { parseDateRangeFilter } from '@barghsa/shared/validation';
import { isInvoiceUuid } from './invoice-uuid.js';
import {
  listChoice,
  listPage,
  parseListQuery,
  type ListQueryOptions,
} from '../hooks/useListQuery.js';

const base: ListQueryOptions = {
  searchLimit: 0,
  filters: {},
  sortFields: [],
  defaultSort: '',
  pageSizes: [25],
  defaultPageSize: 25,
  pagination: 'page',
};
export type ApprovalStatus = 'pending' | 'approved' | 'rejected';
export const approvalQueueQueryOptions: ListQueryOptions = {
  ...base,
  filters: {
    status: (value) => listChoice(['pending', 'approved', 'rejected'])(value) || 'pending',
  },
};
export function approvalQueueSearch(raw: Record<string, unknown>): {
  requestId?: string;
  status?: string;
  page?: number;
} {
  const result: { requestId?: string; status?: string; page?: number } = {};
  const id = typeof raw.requestId === 'string' ? raw.requestId.trim() : '';
  if (isInvoiceUuid(id)) result.requestId = id.toLowerCase();
  const status = approvalQueueQueryOptions.filters.status!(raw.status);
  if (status !== 'pending') result.status = status;
  const page = listPage(raw.page);
  if (page > 1) result.page = page;
  return result;
}
const instant = (value: unknown) => parseDateRangeFilter(value, undefined)?.from || '';
export const reconciliationQueueQueryOptions: ListQueryOptions = {
  ...base,
  filters: {
    status: (value) =>
      listChoice(['all', 'open', 'investigating', 'resolved', 'closed'])(value) || 'open',
    severity: listChoice(['low', 'medium', 'high', 'critical']),
    createdFrom: instant,
    createdBefore: instant,
  },
};
export function reconciliationQueueSearch(raw: Record<string, unknown>): Record<string, unknown> {
  const { filters, page } = parseListQuery(raw, reconciliationQueueQueryOptions);
  const result: Record<string, unknown> = {};
  if (filters.status !== 'open') result.status = filters.status;
  if (filters.severity) result.severity = filters.severity;
  const range = parseDateRangeFilter(filters.createdFrom, filters.createdBefore);
  if (range?.from) result.createdFrom = range.from;
  if (range?.to) result.createdBefore = range.to;
  if (page > 1) result.page = page;
  return result;
}
export function reconciliationApiQuery(filters: Record<string, string>): string {
  const params = new URLSearchParams();
  if (filters.status !== 'all') params.set('status', filters.status || 'open');
  for (const key of ['severity', 'createdFrom', 'createdBefore'])
    if (filters[key]) params.set(key, filters[key]);
  return params.toString();
}
/** Display an applied UTC bound without changing its seconds or milliseconds. */
export function reconciliationLocalTime(value: string, timezone: string): string {
  if (!value) return '';
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(new Date(value));
  const read = (key: string) => parts.find((part) => part.type === key)?.value;
  return `${read('year')}-${read('month')}-${read('day')}T${read('hour')}:${read('minute')}`;
}
