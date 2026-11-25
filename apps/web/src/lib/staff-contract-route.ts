import { notFound, redirect } from '@tanstack/react-router';
import { staffContractFilters } from './record-list-query.js';
import { staffOrderId } from './staff-order-list-query.js';

declare module '@tanstack/react-router' {
  interface HistoryState {
    contractRefundQueue?: { before: string | null; search: Record<string, unknown> } | undefined;
  }
}

const contractRoute = '/admin/contracts/$contractId/{-$action}/{-$item}';

export function contractRecordBeforeLoad({
  params,
  search,
}: {
  params: { contractId: string; action?: string; item?: string };
  search: Record<string, unknown>;
}): void {
  const contractId = staffOrderId(params.contractId).toLowerCase();
  if (!contractId) throw notFound();
  if (contractId !== params.contractId)
    throw redirect({ to: contractRoute, params: { ...params, contractId }, search, replace: true });
}

export function redirectLegacyContract(search: Record<string, unknown>, hash: string): void {
  if (hash === 'refund-obligations')
    throw redirect({
      to: '/admin/contracts/refunds',
      search: staffContractFilters(search),
      replace: true,
    });
  if (typeof search.contractId === 'string')
    throw redirect({
      to: contractRoute,
      params: { contractId: search.contractId.toLowerCase() },
      search: staffContractFilters(search),
      replace: true,
    });
}
