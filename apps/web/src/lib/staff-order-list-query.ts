import type { ListQueryBinding } from '../hooks/useListQuery.js';
import { listChoice, writeListQuery, type ListQueryOptions } from './list-query.js';
import { isInvoiceUuid } from './due-at-override.js';

export interface StaffOrderListQuery {
  queue: ListQueryBinding;
  selected: string | null;
  select: (id: string | null, replace?: boolean) => void;
  changeLane: (value: string) => void;
}
export const staffOrderId = (value: unknown) =>
  typeof value === 'string' && isInvoiceUuid(value) ? value : '';
const options = (key: string, values: string[]): ListQueryOptions => ({
  searchLimit: 0,
  filters: { [key]: listChoice(values) },
  sortFields: [],
  defaultSort: '',
  pageSizes: [20],
  defaultPageSize: 20,
  pagination: 'cursor',
});
export const electricityQueueOptions = options('view', ['review', 'conversations']);
export const savingQueueOptions = options('lane', ['review', 'fulfillment']);
const normalizedOrderQueue = (raw: Record<string, unknown>, config: ListQueryOptions) =>
  writeListQuery({ ...raw, cursor: staffOrderId(raw.cursor).toLowerCase() }, config, {});
export function electricityOrdersSearch(raw: Record<string, unknown>) {
  const orderId = staffOrderId(raw.orderId).toLowerCase();
  return { ...electricityOrderFilters(raw), ...(orderId ? { orderId } : {}) };
}

export interface ElectricityQueueFilters {
  view?: 'review' | 'conversations';
  cursor?: string;
}
export function electricityOrderFilters(raw: Record<string, unknown>): ElectricityQueueFilters {
  const { view, cursor } = normalizedOrderQueue(raw, electricityQueueOptions);
  return {
    ...(view === 'review' || view === 'conversations' ? { view } : {}),
    ...(typeof cursor === 'string' && cursor ? { cursor } : {}),
  };
}

export interface SavingQueueFilters {
  lane?: 'review' | 'fulfillment';
  cursor?: string;
}
export function savingOrderFilters(raw: Record<string, unknown>): SavingQueueFilters {
  const { lane, cursor } = normalizedOrderQueue(raw, savingQueueOptions);
  return {
    ...(lane === 'review' || lane === 'fulfillment' ? { lane } : {}),
    ...(typeof cursor === 'string' && cursor ? { cursor } : {}),
  };
}
export function savingOrdersSearch(raw: Record<string, unknown>) {
  const orderId = staffOrderId(raw.orderId).toLowerCase();
  return { ...savingOrderFilters(raw), ...(orderId ? { orderId } : {}) };
}
