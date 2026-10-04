export const staffFormOrder = {
  orderId: '86000000-0000-4000-8000-000000000002',
  profileId: '86000000-0000-4000-8000-000000000001',
  contractId: '86000000-0000-4000-8000-000000000004',
  invoiceId: '86000000-0000-4000-8000-000000000005',
  versionId: '86000000-0000-4000-8000-000000000006',
  contractState: 'AwaitingStaffReview',
  invoiceState: 'Unpaid',
  customerName: 'Reason Buyer',
  commercialStatus: 'awaiting_staff_review',
  financialStatus: 'unpaid',
  nextAction: 'review_order',
  submittedAt: '2026-10-04T10:00:00.000Z',
  periodStart: '2026-10-05T20:30:00.000Z',
  periodEnd: '2026-10-12T20:30:00.000Z',
  totalKwh: '10',
  pricingSnapshot: { lines: [] },
  settingsSnapshot: {},
  fullAddress: 'Reason Private Street',
  contractSnapshot: {},
  totalIrR: '100',
  paidIrR: '0',
  timeline: [],
};
export function staffFormReview(
  action: 'approve' | 'request-changes' | 'reject' = 'request-changes',
  reason = 'Correct the address'
) {
  return {
    schemaVersion: 1,
    hash: 'b'.repeat(64),
    scope: {
      action: `electricity.staff-review.${action}`,
      profileId: staffFormOrder.profileId,
      resourceId: staffFormOrder.orderId,
    },
    data: {
      action,
      reason: action === 'approve' ? '' : reason,
      customerName: staffFormOrder.customerName,
      contractId: staffFormOrder.contractId,
      contractState: staffFormOrder.contractState,
      versionId: staffFormOrder.versionId,
      versionNumber: 1,
      contractSnapshot: {},
      invoiceId: staffFormOrder.invoiceId,
      invoiceState: 'Unpaid',
      invoiceTotal: '100',
      paidAmount: '0',
      refundedAmount: '0',
      pendingRefundAmount: '0',
      periodStart: staffFormOrder.periodStart,
      periodEnd: staffFormOrder.periodEnd,
      totalKwh: '10',
      pricingSnapshot: {},
      outcome:
        action === 'approve'
          ? 'publish_contract'
          : action === 'request-changes'
            ? 'request_revision'
            : 'cancel_invoice',
      refundAmount: '0',
      releasesGiftCode: false,
    },
  };
}
