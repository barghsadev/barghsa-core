export interface SavingActionContext {
  id: string;
  status: string;
  financial_status: string;
  invoice_id: string | null;
  invoice_state: string | null;
  contract_id: string | null;
  contract_state: string | null;
  cancellation_pending: boolean;
  pending_upgrade_invoice_id?: string | null;
  pending_upgrade_invoice_state?: string | null;
  hardwareUpgrades?: Array<{ status: string; adjustmentInvoiceId: string; invoiceState?: string }>;
}

export type SavingNextAction =
  | 'awaitCancellation'
  | 'awaitReview'
  | 'awaitInvoice'
  | 'awaitPaymentReview'
  | 'acceptContract'
  | 'payInvoice'
  | 'payUpgrade'
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
  const pendingUpgrade = order.hardwareUpgrades?.find(
    (upgrade) => upgrade.status === 'awaiting_payment'
  );
  const pendingUpgradeInvoiceId =
    pendingUpgrade?.adjustmentInvoiceId ?? order.pending_upgrade_invoice_id;
  const pendingUpgradeInvoiceState =
    pendingUpgrade?.invoiceState ?? order.pending_upgrade_invoice_state;
  if (pendingUpgradeInvoiceId)
    return {
      kind:
        pendingUpgradeInvoiceState === 'PaymentUnderReview' ? 'awaitPaymentReview' : 'payUpgrade',
      href: `/invoices/${encodeURIComponent(pendingUpgradeInvoiceId)}`,
    };
  if (['draft', 'submitted', 'awaiting_staff_review'].includes(order.status))
    return { kind: 'awaitReview', href: null };
  if (order.invoice_state === 'PaymentUnderReview')
    return { kind: 'awaitPaymentReview', href: invoiceHref };
  if (order.contract_state === 'AwaitingCustomerAcceptance')
    return { kind: 'acceptContract', href: contractHref };
  if (
    !order.invoice_id ||
    !order.invoice_state ||
    ['Draft', 'Cancelled'].includes(order.invoice_state)
  )
    return { kind: 'awaitInvoice', href: null };
  if (order.invoice_state && ['Unpaid', 'PartiallyFunded', 'Overdue'].includes(order.invoice_state))
    return { kind: 'payInvoice', href: invoiceHref };
  return { kind: 'awaitFulfillment', href: null };
}
