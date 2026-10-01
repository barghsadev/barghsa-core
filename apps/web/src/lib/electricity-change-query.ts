import { listChoice, type ListQueryOptions } from '../hooks/useListQuery.js';
import { staffOrderId } from './staff-order-list-query.js';
const publicId = (value: unknown) =>
  typeof value === 'string' && value === value.trim() ? staffOrderId(value) : '';

const base: ListQueryOptions = {
  searchLimit: 0,
  filters: {},
  sortFields: [],
  defaultSort: '',
  pageSizes: [50],
  defaultPageSize: 50,
  pagination: 'cursor',
};
export const electricityIncreaseQueryOptions: ListQueryOptions = {
  ...base,
  filters: { status: (value) => listChoice(['pending', 'expired'])(value) || 'pending' },
};
export const electricityPriceQueryOptions: ListQueryOptions = {
  ...base,
  filters: { contractId: publicId },
};
export function electricityIncreaseSearch(raw: Record<string, unknown>): Record<string, unknown> {
  const status = electricityIncreaseQueryOptions.filters.status!(raw.status);
  return {
    status: status === 'pending' ? undefined : status,
    cursor: publicId(raw.cursor) || undefined,
  };
}
export function electricityPriceSearch(raw: Record<string, unknown>): Record<string, unknown> {
  return { contractId: publicId(raw.contractId) || undefined };
}
