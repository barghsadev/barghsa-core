export const electricityCommercialStatuses = [
  'draft',
  'submitted',
  'awaiting_staff_review',
  'changes_requested',
  'approved',
  'active',
  'completed',
  'rejected',
  'cancelled',
] as const;
export type ElectricityCommercialStatus = (typeof electricityCommercialStatuses)[number];

const transitions: Record<ElectricityCommercialStatus, readonly ElectricityCommercialStatus[]> = {
  draft: ['submitted'],
  submitted: ['awaiting_staff_review', 'rejected', 'cancelled'],
  awaiting_staff_review: ['changes_requested', 'approved', 'rejected', 'cancelled'],
  changes_requested: ['submitted', 'rejected', 'cancelled'],
  approved: ['active', 'rejected', 'cancelled'],
  active: ['completed', 'cancelled'],
  completed: [],
  rejected: [],
  cancelled: [],
};

export function canTransitionElectricityOrder(
  from: ElectricityCommercialStatus,
  to: ElectricityCommercialStatus
) {
  return transitions[from].includes(to);
}

export type ElectricityFinancialStatus =
  | 'unpaid'
  | 'payment_under_review'
  | 'partially_funded'
  | 'paid'
  | 'refund_pending'
  | 'partially_refunded'
  | 'refunded';

/** Invoice and refund ledgers remain the source of truth for financial status. */
export function electricityFinancialStatus(input: {
  invoiceState: string;
  totalAmount: string;
  paidAmount: string;
  refundedAmount: string;
  pendingRefundAmount: string;
}): ElectricityFinancialStatus {
  const total = BigInt(input.totalAmount);
  const paid = BigInt(input.paidAmount);
  const refunded = BigInt(input.refundedAmount);
  const pending = BigInt(input.pendingRefundAmount);
  if (
    paid < 0n ||
    refunded < 0n ||
    pending < 0n ||
    refunded + pending > paid ||
    (total > 0n && paid > total)
  )
    throw new Error('Invalid electricity financial totals');
  if (paid > 0n && refunded === paid) return 'refunded';
  if (pending > 0n) return 'refund_pending';
  if (refunded > 0n) return 'partially_refunded';
  if (input.invoiceState === 'PaymentUnderReview') return 'payment_under_review';
  if (total > 0n && paid >= total) return 'paid';
  if (paid > 0n) return 'partially_funded';
  return 'unpaid';
}

export function electricityNextAction(
  commercial: ElectricityCommercialStatus,
  financial: ElectricityFinancialStatus,
  audience: 'customer' | 'staff',
  contractState?: string
) {
  if (financial === 'refund_pending' || financial === 'partially_refunded')
    return audience === 'staff' ? 'process_refund' : 'await_refund';
  if (commercial === 'awaiting_staff_review')
    return audience === 'staff' ? 'review_order' : 'await_review';
  if (commercial === 'changes_requested')
    return audience === 'staff' ? 'await_customer_changes' : 'resubmit_changes';
  if (commercial === 'approved') {
    if (financial === 'payment_under_review' && audience === 'customer')
      return 'await_payment_review';
    if (financial !== 'paid') return audience === 'staff' ? 'await_payment' : 'pay_invoice';
    if (contractState === 'Accepted' || contractState === 'Signed') return 'await_activation';
    return audience === 'staff' ? 'await_contract_acceptance' : 'accept_contract';
  }
  if (commercial === 'active') return 'await_delivery';
  if (commercial === 'completed') return 'none';
  if (commercial === 'rejected' || commercial === 'cancelled') return 'none';
  return audience === 'staff' ? 'await_submission' : 'continue_order';
}
