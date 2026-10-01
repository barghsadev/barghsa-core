import { listPage, parseListQuery, type ListQueryOptions } from '../hooks/useListQuery.js';

const base: ListQueryOptions = {
  searchLimit: 0,
  filters: {},
  sortFields: [],
  defaultSort: '',
  pageSizes: [25],
  defaultPageSize: 25,
  pagination: 'page',
};
export const staffDirectoryQueryOptions = base;
export const roleComparisonQueryOptions: ListQueryOptions = {
  ...base,
  filters: {
    module: (value) =>
      typeof value === 'string' && /^[a-z][a-z0-9_-]{0,79}$/.test(value) ? value : '',
  },
};
export function staffDirectorySearch(raw: Record<string, unknown>): Record<string, unknown> {
  const page = listPage(raw.page);
  return page > 1 ? { page } : {};
}
export function roleComparisonSearch(raw: Record<string, unknown>): Record<string, unknown> {
  const module = parseListQuery(raw, roleComparisonQueryOptions).filters.module;
  return module ? { module } : {};
}
