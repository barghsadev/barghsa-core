import { statusTone, type StatusTone } from '@barghsa/ui';

export function commercialStatusTone(status: string): StatusTone {
  return commercialStates.has(typeof status === 'string' ? status.toLowerCase() : '')
    ? statusTone(status)
    : 'default';
}

export function financialStatusTone(status: string): StatusTone {
  return financialStates.has(typeof status === 'string' ? status.toLowerCase() : '')
    ? statusTone(status)
    : 'default';
}

const commercialStates = new Set([
  'draft',
  'submitted',
  'awaiting_staff_review',
  'changes_requested',
  'approved',
  'active',
  'completed',
  'rejected',
  'cancelled',
]);
const financialStates = new Set([
  'unpaid',
  'payment_under_review',
  'partially_funded',
  'paid',
  'refund_pending',
  'partially_refunded',
  'refunded',
]);

/** Never expose machine identifiers or missing translation keys in a customer/staff status. */
export function electricityStatusKey(status: string, kind: 'commercial' | 'financial'): string {
  const value = typeof status === 'string' ? status.toLowerCase() : '';
  if (!(kind === 'commercial' ? commercialStates : financialStates).has(value))
    return 'electricity.order.status.unknown';
  return `electricity.order.${kind === 'commercial' ? 'status' : 'financial'}.${value}`;
}
