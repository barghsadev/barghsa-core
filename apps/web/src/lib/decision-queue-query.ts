import { parseDateRangeFilter } from '@barghsa/shared/validation';
import { redirect } from '@tanstack/react-router';
import { isInvoiceUuid } from './invoice-uuid.js';
import { listChoice, listPage, parseListQuery, type ListQueryOptions } from './list-query.js';

const base: ListQueryOptions = {
  searchLimit: 0,
  filters: {},
  sortFields: [],
  defaultSort: '',
  pageSizes: [25],
  defaultPageSize: 25,
  pagination: 'page',
};
export type ApprovalStatus = 'pending' | 'approved' | 'rejected';
const parseApprovalStatus = listChoice(['pending', 'approved', 'rejected']);
export const approvalQueueQueryOptions: ListQueryOptions = {
  ...base,
  filters: {
    status: (value) => parseApprovalStatus(value) || 'pending',
  },
};
type ApprovalFilters = { status?: string; page?: number };
export function approvalQueueFilters(raw: Record<string, unknown>): ApprovalFilters {
  const status = parseApprovalStatus(raw.status);
  const page = listPage(raw.page);
  return {
    ...(status && status !== 'pending' ? { status } : {}),
    ...(page > 1 ? { page } : {}),
  };
}
export function approvalQueueSearch(
  raw: Record<string, unknown>
): ApprovalFilters & { requestId?: string } {
  const search = approvalQueueFilters(raw);
  const id = typeof raw.requestId === 'string' ? raw.requestId.trim() : '';
  return isInvoiceUuid(id) ? { ...search, requestId: id.toLowerCase() } : search;
}
export const approvalRequestRoute = '/admin/approval-requests/$requestId/{-$decision}';
export function redirectToApprovalRequest(
  params: { requestId: string; decision?: string | undefined },
  search: ApprovalFilters
): never {
  throw redirect({ to: approvalRequestRoute, params, search, replace: true });
}
const instant = (value: unknown) => parseDateRangeFilter(value, undefined)?.from || '';
export const reconciliationQueueQueryOptions: ListQueryOptions = {
  ...base,
  filters: {
    status: (value) =>
      listChoice(['all', 'open', 'investigating', 'resolved', 'closed'])(value) || 'open',
    severity: listChoice(['low', 'medium', 'high', 'critical']),
    createdFrom: instant,
    createdBefore: instant,
  },
};
export function reconciliationQueueSearch(raw: Record<string, unknown>): Record<string, unknown> {
  const { filters, page } = parseListQuery(raw, reconciliationQueueQueryOptions);
  const result: Record<string, unknown> = {};
  if (filters.status !== 'open') result.status = filters.status;
  if (filters.severity) result.severity = filters.severity;
  const range = parseDateRangeFilter(filters.createdFrom, filters.createdBefore);
  if (range?.from) result.createdFrom = range.from;
  if (range?.to) result.createdBefore = range.to;
  if (page > 1) result.page = page;
  return result;
}
