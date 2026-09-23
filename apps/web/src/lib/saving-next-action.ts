export interface SavingActionContext {
  id: string;
  status: string;
  financial_status: string;
  invoice_id: string | null;
  invoice_state: string | null;
  contract_id: string | null;
  contract_state: string | null;
  cancellation_pending: boolean;
}

export type SavingNextAction =
  | 'awaitCancellation'
  | 'awaitReview'
  | 'awaitPaymentReview'
  | 'acceptContract'
  | 'payInvoice'
  | 'awaitFulfillment'
  | 'trackRefund'
  | 'none';

export function savingNextAction(order: SavingActionContext): {
  kind: SavingNextAction;
  href: string | null;
} {
  const invoiceHref = order.invoice_id ? `/invoices/${encodeURIComponent(order.invoice_id)}` : null;
  const contractHref = order.contract_id
    ? `/contracts?contractId=${encodeURIComponent(order.contract_id)}`
    : null;
  const refundHref = `/savings/orders/${encodeURIComponent(order.id)}${order.status === 'cancelled' ? '#saving-cancellation' : ''}`;
  if (order.status === 'cancelled' || order.status === 'rejected')
    return order.financial_status === 'refund_pending'
      ? { kind: 'trackRefund', href: refundHref }
      : { kind: 'none', href: null };
  if (order.status === 'completed') return { kind: 'none', href: null };
  if (order.cancellation_pending) return { kind: 'awaitCancellation', href: null };
  if (['draft', 'submitted', 'awaiting_staff_review'].includes(order.status))
    return { kind: 'awaitReview', href: null };
  if (order.invoice_state === 'PaymentUnderReview')
    return { kind: 'awaitPaymentReview', href: invoiceHref };
  if (order.contract_state === 'AwaitingCustomerAcceptance')
    return { kind: 'acceptContract', href: contractHref };
  if (
    order.invoice_state &&
    ['Draft', 'Unpaid', 'Overdue', 'PartiallyPaid'].includes(order.invoice_state)
  )
    return { kind: 'payInvoice', href: invoiceHref };
  return { kind: 'awaitFulfillment', href: null };
}
