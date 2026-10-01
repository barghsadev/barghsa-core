import {
  listChoice,
  writeListQuery,
  type ListQueryOptions,
  type ListQueryBinding,
} from '../hooks/useListQuery.js';
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
export function staffOrdersSearch(raw: Record<string, unknown>, config: ListQueryOptions) {
  const normalized = writeListQuery({ ...raw, cursor: staffOrderId(raw.cursor) }, config, {});
  return Object.fromEntries([
    ...Object.keys(config.filters).map((key) => [key, normalized[key]]),
    ['cursor', normalized.cursor],
    ['orderId', staffOrderId(raw.orderId) || undefined],
  ]);
}
export const electricityOrdersSearch = (raw: Record<string, unknown>) =>
  staffOrdersSearch(raw, electricityQueueOptions);
export const savingOrdersSearch = (raw: Record<string, unknown>) =>
  staffOrdersSearch(raw, savingQueueOptions);
