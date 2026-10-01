import {
  listChoice,
  writeListQuery,
  type ListQueryOptions,
  type ListQueryBinding,
} from '../hooks/useListQuery.js';
import { staffOrderId } from './staff-order-list-query.js';

export interface SupportListQuery {
  queue: ListQueryBinding;
  selected: string | null;
  select: (id: string | null, replace?: boolean) => void;
}
export interface ConsultationListQuery extends SupportListQuery {
  setFilters: (filters: Record<string, string>) => void;
}
export const ticketQueryOptions: ListQueryOptions = {
  searchLimit: 200,
  filters: {
    status: listChoice([
      'active',
      'open',
      'in_progress',
      'waiting_customer',
      'waiting_staff',
      'resolved',
      'closed',
    ]),
  },
  sortFields: [],
  defaultSort: '',
  pageSizes: [20],
  defaultPageSize: 20,
  pagination: 'page',
};
export const consultationQueryOptions: ListQueryOptions = {
  ...ticketQueryOptions,
  searchLimit: 0,
  filters: {
    status: listChoice([
      'submitted',
      'under_review',
      'awaiting_customer_info',
      'offer_pending',
      'offer_accepted',
      'offer_declined',
      'completed',
      'rejected',
      'cancelled',
    ]),
    assignment: listChoice(['all', 'mine', 'unassigned']),
    priority: listChoice(['all', 'high', 'normal']),
    minAgeDays: (value) =>
      listChoice(['0', '1', '7'])(typeof value === 'number' ? String(value) : value),
  },
  pagination: 'cursor',
};
export function ticketsSearch(raw: Record<string, unknown>, customer = false) {
  const normalized = writeListQuery(raw, ticketQueryOptions, {});
  return {
    q: normalized.q,
    order: normalized.order,
    status: normalized.status,
    page: normalized.page,
    ticketId: staffOrderId(raw.ticketId) || undefined,
    ...(customer ? { scope: raw.scope === 'active' ? ('active' as const) : undefined } : {}),
  };
}
export const staffTicketsSearch = (raw: Record<string, unknown>) => ticketsSearch(raw);
export const customerTicketsSearch = (raw: Record<string, unknown>) => ticketsSearch(raw, true);
export function consultationSearch(raw: Record<string, unknown>) {
  const normalized = writeListQuery(
    { ...raw, cursor: staffOrderId(raw.cursor) },
    consultationQueryOptions,
    {}
  );
  return Object.fromEntries([
    ...Object.keys(consultationQueryOptions.filters).map((key) => [key, normalized[key]]),
    ['cursor', normalized.cursor],
    ['requestId', staffOrderId(raw.requestId) || undefined],
  ]);
}
