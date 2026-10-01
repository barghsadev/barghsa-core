import { listChoice, type ListQueryOptions } from './list-query.js';

/** Preserve the API's timestamp/UUID boundary, including PostgreSQL microseconds. */
export function notificationInboxCursor(value: unknown): string {
  if (typeof value !== 'string' || value.length > 2000 || !/^[A-Za-z0-9_-]+$/.test(value))
    return '';
  try {
    const raw = atob(value.replace(/-/g, '+').replace(/_/g, '/'));
    const [timestamp, id, extra] = raw.split('|');
    if (
      extra !== undefined ||
      !timestamp ||
      !id ||
      !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?Z$/.test(timestamp) ||
      !Number.isFinite(Date.parse(timestamp)) ||
      !/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(id) ||
      btoa(raw).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '') !== value
    )
      return '';
    return value;
  } catch {
    return '';
  }
}
export const notificationInboxQueryOptions: ListQueryOptions = {
  searchLimit: 0,
  filters: { filter: (value) => listChoice(['all', 'unread'])(value) || 'all' },
  sortFields: [],
  defaultSort: '',
  pageSizes: [20],
  defaultPageSize: 20,
  pagination: 'cursor',
};
export function notificationInboxSearch(raw: Record<string, unknown>): Record<string, unknown> {
  return {
    filter: raw.filter === 'unread' ? 'unread' : undefined,
    cursor: notificationInboxCursor(raw.cursor) || undefined,
  };
}
