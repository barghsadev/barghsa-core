import { listText, type ListQueryOptions } from './list-query.js';
import { staffOrderId } from './staff-order-list-query.js';
export const solarConstructionQueryOptions: ListQueryOptions = {
  searchLimit: 200,
  filters: {},
  sortFields: [],
  defaultSort: '',
  pageSizes: [50],
  defaultPageSize: 50,
  pagination: 'cursor',
};
export function solarConstructionSearch(raw: Record<string, unknown>): Record<string, unknown> {
  const q =
    typeof raw.q === 'number' && Number.isSafeInteger(raw.q) && raw.q >= 0 ? String(raw.q) : raw.q;
  return {
    q: listText(200)(q) || undefined,
    cursor: staffOrderId(raw.cursor) || undefined,
    requestId: staffOrderId(raw.requestId) || undefined,
  };
}
