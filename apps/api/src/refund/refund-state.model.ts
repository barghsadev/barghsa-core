import type { Refund } from '@barghsa/db';
export type RefundState = Refund['state'];
export const REFUND_TRANSITIONS: Readonly<Record<RefundState, readonly RefundState[]>> = {
  Requested: ['Approved', 'Rejected', 'Cancelled'],
  Approved: ['Processing', 'Rejected', 'Cancelled'],
  Processing: ['Completed', 'Failed'],
  Failed: ['Processing'],
  Completed: [],
  Rejected: [],
  Cancelled: [],
};
export function assertRefundTransition(from: RefundState, to: RefundState): void {
  if (!REFUND_TRANSITIONS[from]?.includes(to))
    throw new Error(`Refund cannot transition from ${from} to ${to}`);
}
