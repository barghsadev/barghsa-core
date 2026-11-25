import type { ListQueryBinding } from '../hooks/useListQuery.js';
import { listChoice, writeListQuery, type ListQueryOptions } from './list-query.js';
import { staffOrderId } from './staff-order-list-query.js';

export interface SupportListQuery {
  queue: ListQueryBinding;
  selected: string | null;
  select: (id: string | null, replace?: boolean) => void;
}
export interface ConsultationListQuery
  extends Pick<SupportListQuery, 'queue'>, Partial<Omit<SupportListQuery, 'queue'>> {
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
export function staffTicketFilters(raw: Record<string, unknown>) {
  const normalized = writeListQuery(raw, ticketQueryOptions, {});
  return {
    q: normalized.q,
    order: normalized.order,
    status: normalized.status,
    page: normalized.page,
  };
}
export function staffTicketsSearch(raw: Record<string, unknown>) {
  return { ...staffTicketFilters(raw), ticketId: staffOrderId(raw.ticketId) || undefined };
}
export function customerTicketsSearch(raw: Record<string, unknown>) {
  return { ...customerTicketFilters(raw), ticketId: staffOrderId(raw.ticketId) || undefined };
}
export function customerTicketFilters(raw: Record<string, unknown>) {
  return {
    ...staffTicketFilters(raw),
    scope: raw.scope === 'active' ? ('active' as const) : undefined,
  };
}
export type CustomerTicketFilters = ReturnType<typeof customerTicketFilters>;
export type TicketListFilters = ReturnType<typeof staffTicketFilters> &
  Partial<Pick<CustomerTicketFilters, 'scope'>>;
export type TicketRelatedRecord = {
  relatedType: 'order' | 'invoice' | 'contract';
  relatedId: string;
};
export function newTicketSearch(raw: Record<string, unknown>) {
  return { ...customerTicketFilters(raw), ...ticketRelatedRecord(raw) };
}
export function ticketRelatedRecord(raw: Record<string, unknown>): TicketRelatedRecord | undefined {
  const relatedId = staffOrderId(raw.relatedId);
  const relatedType = raw.relatedType;
  if (
    relatedId &&
    (relatedType === 'order' || relatedType === 'invoice' || relatedType === 'contract')
  )
    return { relatedType, relatedId };
  return undefined;
}
export function consultationFilters(raw: Record<string, unknown>) {
  const normalized = writeListQuery(
    { ...raw, cursor: staffOrderId(raw.cursor).toLowerCase() },
    consultationQueryOptions,
    {}
  );
  return {
    status: normalized.status,
    assignment: normalized.assignment,
    priority: normalized.priority,
    minAgeDays: normalized.minAgeDays,
    cursor: normalized.cursor,
  };
}
export function consultationSearch(raw: Record<string, unknown>) {
  return {
    ...consultationFilters(raw),
    requestId: staffOrderId(raw.requestId).toLowerCase() || undefined,
  };
}
export type ConsultationFilters = ReturnType<typeof consultationFilters>;
