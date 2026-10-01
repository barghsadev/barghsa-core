import { listChoice, type ListQueryBinding, type ListQueryOptions } from '../hooks/useListQuery.js';
import { staffOrderId } from './staff-order-list-query.js';

const base: ListQueryOptions = {
  searchLimit: 0,
  filters: {},
  sortFields: [],
  defaultSort: '',
  pageSizes: [100],
  defaultPageSize: 100,
  pagination: 'cursor',
};
export const solarPostalQueryOptions: ListQueryOptions = {
  ...base,
  filters: {
    lane: (value) => listChoice(['needs_staff', 'waiting_customer', 'all'])(value) || 'needs_staff',
  },
};
export const solarRequestsQueryOptions: ListQueryOptions = { ...base, prefix: 'requests_' };
export const solarFilesQueryOptions: ListQueryOptions = { ...base, prefix: 'files_' };
export interface SolarDocumentQueries {
  requests: ListQueryBinding;
  files: ListQueryBinding;
  reset: () => void;
}
export function solarPostalSearch(raw: Record<string, unknown>): Record<string, unknown> {
  const lane = solarPostalQueryOptions.filters.lane!(raw.lane);
  return {
    lane: lane === 'needs_staff' ? undefined : lane,
    cursor: staffOrderId(raw.cursor) || undefined,
  };
}
export function solarDocumentsSearch(raw: Record<string, unknown>): Record<string, unknown> {
  return {
    requests_cursor: staffOrderId(raw.requests_cursor) || undefined,
    files_cursor: staffOrderId(raw.files_cursor) || undefined,
  };
}
