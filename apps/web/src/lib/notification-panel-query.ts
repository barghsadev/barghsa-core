import {
  listChoice,
  listText,
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
export const previewQueryOptions: ListQueryOptions = {
  ...base,
  prefix: 'preview_',
  filters: {
    event: listText(100),
    channel: listChoice(['email', 'sms', 'in_app']),
    locale: listChoice(['fa', 'en']),
    version: listText(200),
  },
};
export const failedNotificationQueryOptions: ListQueryOptions = {
  ...base,
  prefix: 'failed_',
  filters: {
    // The queue starts with open messages; "all" is an explicit separate choice.
    status: (value) =>
      listChoice(['all', 'open', 'retried', 'resolved', 'dismissed'])(value) || 'open',
    channel: listChoice(['email', 'sms', 'in_app']),
    severity: listChoice(['error', 'critical']),
  },
};
export function failedNotificationsSearch(raw: Record<string, unknown>): Record<string, unknown> {
  const query = parseListQuery(raw, failedNotificationQueryOptions);
  return {
    failed_status: query.filters.status === 'open' ? undefined : query.filters.status,
    failed_channel: query.filters.channel || undefined,
    failed_severity: query.filters.severity || undefined,
    // The existing API accepts offsets through 1,000,000, in pages of 25.
    failed_page: query.page > 1 && query.page <= 40_001 ? query.page : undefined,
  };
}
export function notificationPanelSearch(raw: Record<string, unknown>): Record<string, unknown> {
  const preview = parseListQuery(raw, previewQueryOptions);
  const result = {
    ...failedNotificationsSearch(raw),
    ...Object.fromEntries(
      Object.entries(preview.filters).map(([key, value]) => ['preview_' + key, value || undefined])
    ),
  };
  return Object.fromEntries(Object.entries(result).filter(([, value]) => value !== undefined));
}
