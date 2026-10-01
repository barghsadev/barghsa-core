import { BACKGROUND_JOB_TYPES } from '@barghsa/shared/admin';
import { listChoice, parseListQuery, type ListQueryOptions } from './list-query.js';

const base: ListQueryOptions = {
  searchLimit: 0,
  filters: {},
  sortFields: [],
  defaultSort: '',
  pageSizes: [25],
  defaultPageSize: 25,
  pagination: 'page',
};
const uuid = (value: unknown) =>
  typeof value === 'string' && /^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(value.trim())
    ? value.trim()
    : '';
const page = (value: number, maximum = 40_001) =>
  value > 1 && value <= maximum ? value : undefined;
export const failedJobQueryOptions: ListQueryOptions = {
  ...base,
  filters: {
    status: (value) =>
      listChoice(['failed', 'retrying', 'dead_letter', 'resolved', 'all'])(value) || 'failed',
    jobType: listChoice(BACKGROUND_JOB_TYPES.map((type) => type.key)),
  },
};
export const deliveryHistoryQueryOptions: ListQueryOptions = {
  ...base,
  prefix: 'history_',
  filters: {
    mode: listChoice(['all', 'target']),
    notificationId: uuid,
    channel: listChoice(['email', 'sms', 'in_app']),
    status: listChoice(['delivered', 'failed', 'sending', 'unknown']),
  },
};
export function failedJobsSearch(raw: Record<string, unknown>): Record<string, unknown> {
  const query = parseListQuery(raw, failedJobQueryOptions);
  return {
    status: query.filters.status === 'failed' ? undefined : query.filters.status,
    jobType: query.filters.jobType || undefined,
    page: page(query.page),
  };
}
export function deliveryHistorySearch(raw: Record<string, unknown>): Record<string, unknown> {
  const query = parseListQuery(raw, deliveryHistoryQueryOptions);
  const mode = query.filters.mode;
  const result = {
    history_mode:
      mode === 'target' && (!query.filters.notificationId || !query.filters.channel)
        ? undefined
        : mode || undefined,
    history_notificationId: query.filters.notificationId || undefined,
    history_channel: query.filters.channel || undefined,
    history_status: mode === 'target' ? undefined : query.filters.status || undefined,
    history_page: page(query.page, 1_000_000),
  };
  return Object.fromEntries(Object.entries(result).filter(([, value]) => value !== undefined));
}
