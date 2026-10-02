export const electricityTimelineKeys: Record<string, string> = {
  order_created: 'electricity.order.timeline.submitted',
  'electricity.order_submitted': 'electricity.order.timeline.submitted',
  'electricity.order_review.approve': 'electricity.order.timeline.approved',
  'electricity.order_review.request-changes': 'electricity.order.timeline.changes',
  'electricity.order_review.reject': 'electricity.order.timeline.rejected',
  'electricity.order_resubmitted': 'electricity.order.timeline.resubmitted',
  'electricity.order_cancelled': 'electricity.order.timeline.cancelled',
  'refund.processing': 'electricity.order.timeline.refundProcessing',
  'refund.completed': 'electricity.order.timeline.refundCompleted',
  'refund.failed': 'electricity.order.timeline.refundFailed',
  'refund.retry_exhausted': 'electricity.order.timeline.refundFailed',
  'contract.activated': 'electricity.order.timeline.activated',
  'contract.completed': 'electricity.order.timeline.completed',
  'contract.cancelled': 'electricity.order.timeline.cancelled',
};

const eventStates = new Map([
  ['order_created', 'submitted'],
  ['electricity.order_submitted', 'submitted'],
  ['electricity.order_review.approve', 'approved'],
  ['electricity.order_review.request-changes', 'changes_requested'],
  ['electricity.order_review.reject', 'rejected'],
  ['electricity.order_resubmitted', 'submitted'],
  ['electricity.order_cancelled', 'cancelled'],
  ['refund.processing', 'pending'],
  ['refund.completed', 'completed'],
  ['refund.failed', 'failed'],
  ['refund.retry_exhausted', 'failed'],
  ['contract.activated', 'active'],
  ['contract.completed', 'completed'],
  ['contract.cancelled', 'cancelled'],
]);
export const electricityTimelineState = (event: string) => eventStates.get(event);
export const electricityTimelineKey = (event: string) =>
  Object.hasOwn(electricityTimelineKeys, event)
    ? electricityTimelineKeys[event]!
    : 'electricity.order.timeline.updated';
