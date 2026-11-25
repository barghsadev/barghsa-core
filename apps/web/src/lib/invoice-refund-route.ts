import { notFound, redirect } from '@tanstack/react-router';
import type { RefundOperation } from '../hooks/useRefundForm.js';
import { invoiceQueueSearch } from './finance-list-query.js';
import { isInvoiceUuid } from './invoice-uuid.js';

export type InvoiceRefundDestination = 'wallet' | 'bank';
export type InvoiceRefundDecision = { refundId: string; operation: RefundOperation };

const operations: readonly RefundOperation[] = [
  'approve',
  'reject',
  'cancel',
  'process',
  'record-transfer',
  'reconcile',
];

export function invoiceRefundOperation(value: string | undefined) {
  return operations.find((operation) => operation === value);
}

export function refundOperations(row: {
  state: string;
  destination: 'wallet' | 'external_bank';
}): RefundOperation[] {
  if (row.state === 'Requested') return ['approve', 'reject', 'cancel'];
  if (row.state === 'Approved')
    return ['cancel', row.destination === 'wallet' ? 'process' : 'record-transfer'];
  if (row.state === 'Processing' && row.destination === 'external_bank') return ['reconcile'];
  if (row.state === 'Failed' && row.destination === 'wallet') return ['process'];
  return [];
}

export function contractRefundOperation(
  row: { state: string; destination: 'wallet' | 'external_bank'; bankReference: string | null },
  exhausted = false
): RefundOperation | undefined {
  if (row.destination === 'wallet')
    return row.state === 'Failed' && exhausted ? 'process' : undefined;
  if (row.state === 'Approved') return 'record-transfer';
  if (row.state === 'Processing' && row.bankReference) return 'reconcile';
  return undefined;
}

export function invoiceRefundDestination(
  value: string | undefined
): InvoiceRefundDestination | undefined {
  return value === 'wallet' || value === 'bank' ? value : undefined;
}

export function invoiceRefundDestinationFromHash(
  hash: string
): InvoiceRefundDestination | undefined {
  if (hash === 'wallet-refunds-panel') return 'wallet';
  if (hash === 'external-refunds-panel') return 'bank';
  return undefined;
}

export function validateInvoiceAction(
  params: {
    invoiceId: string;
    action: string;
    destination?: string;
    view?: string;
    operation?: string;
  },
  search: ReturnType<typeof invoiceQueueSearch>,
  hash: string
): void {
  const invoiceId = params.invoiceId.trim().toLowerCase();
  const destination = invoiceRefundDestination(params.destination);
  const operation = invoiceRefundOperation(params.operation);
  const view = params.operation ? params.view?.toLowerCase() : params.view;
  const validDecision =
    view &&
    isInvoiceUuid(view) &&
    operation &&
    (destination === 'wallet'
      ? operation !== 'record-transfer' && operation !== 'reconcile'
      : operation !== 'process');
  if (
    !isInvoiceUuid(invoiceId) ||
    (params.destination && !destination) ||
    (params.action !== 'refunds' && (destination || view || params.operation)) ||
    ((view || params.operation) &&
      (!destination || (params.operation ? !validDecision : view !== 'new')))
  )
    throw notFound();
  const oldDestination =
    params.action === 'refunds' && !destination
      ? invoiceRefundDestinationFromHash(hash)
      : undefined;
  if (invoiceId !== params.invoiceId || view !== params.view || oldDestination) {
    throw redirect({
      to: '/admin/invoices/$invoiceId/$action/{-$destination}/{-$view}/{-$operation}',
      params: { ...params, invoiceId, view, destination: destination ?? oldDestination },
      search,
      hash: oldDestination ? '' : hash,
      replace: true,
    });
  }
}

export function redirectLegacyInvoiceList(search: Record<string, unknown>, hash: string): void {
  const recordSearch = invoiceQueueSearch(search);
  if (typeof search.invoiceId !== 'string') {
    if (
      ['invoice-deadline-panel', 'invoice-corrections-panel', 'invoice-refunds-panel'].includes(
        hash
      )
    ) {
      throw redirect({
        to: '/admin/invoices/tools/{-$section}/{-$service}',
        params: { section: undefined, service: undefined },
        search: recordSearch,
        hash,
        replace: true,
      });
    }
    return;
  }
  const invoiceId = search.invoiceId.toLowerCase();
  const destination = invoiceRefundDestinationFromHash(hash);
  if (destination) {
    throw redirect({
      to: '/admin/invoices/$invoiceId/$action/{-$destination}/{-$view}/{-$operation}',
      params: { invoiceId, action: 'refunds', destination, view: undefined },
      search: recordSearch,
      replace: true,
    });
  }
  throw redirect({
    to: '/admin/invoices/$invoiceId',
    params: { invoiceId },
    search: recordSearch,
    replace: true,
  });
}
