export function refundReviewFixture(
  invoiceId: string,
  destination: 'wallet' | 'external_bank',
  amount: string,
  reason: string
) {
  const profileId = '33333333-3333-4333-8333-333333333333';
  return {
    schemaVersion: 1,
    scope: { action: `refund.${destination}.request`, profileId, resourceId: invoiceId },
    hash: 'a'.repeat(64),
    data: {
      currency: 'IRR',
      profile: { id: profileId, title: 'Fixture customer', type: 'individual' },
      invoice: {
        id: invoiceId,
        state: 'Paid',
        orderId: null,
        serviceType: null,
        issuedAt: null,
        payableFrom: null,
        dueAt: null,
        totalAmount: '100',
        paidAmount: '100',
        remainingAmount: '0',
      },
      lines: [],
      totals: null,
      contracts: [],
      cancellation: 'separate_review_required',
      refund: {
        destination,
        amount,
        reason,
        refundedBefore: '0',
        reservedBefore: '0',
        availableBefore: '100',
        availableAfter: String(100n - BigInt(amount)),
        approvalRequired: false,
      },
    },
  };
}

export function refundDecisionReviewFixture(
  invoiceId: string,
  refundId: string,
  destination: 'wallet' | 'external_bank',
  state: string,
  action: 'approve' | 'reject' | 'cancel' | 'process' | 'record-transfer' | 'reconcile',
  bankReference: string | null = null,
  reason: string | null = null,
  amount = '40'
) {
  const base = refundReviewFixture(invoiceId, destination, '40', 'Customer return');
  const targetState =
    action === 'approve'
      ? 'Approved'
      : action === 'reject'
        ? 'Rejected'
        : action === 'cancel'
          ? 'Cancelled'
          : action === 'reconcile'
            ? 'Completed'
            : 'Processing';
  return {
    ...base,
    scope: { ...base.scope, action: `refund.${destination}.${action}`, resourceId: refundId },
    hash: 'b'.repeat(64),
    data: {
      ...base.data,
      invoice: {
        ...base.data.invoice,
        totalAmount: (BigInt(amount) + 60n).toString(),
        paidAmount: (BigInt(amount) + 60n).toString(),
      },
      refund: {
        id: refundId,
        destination,
        state,
        amount,
        refundedBefore: '0',
        reservedBefore: amount,
        availableBefore: '60',
        availableAfter:
          action === 'reject' || action === 'cancel' ? (BigInt(amount) + 60n).toString() : '60',
        bankReference: state === 'Processing' ? bankReference : null,
        reconciliationStatus: state === 'Processing' ? 'Pending' : null,
        approvalRequired: ['approve', 'process', 'record-transfer'].includes(action) ? false : null,
        approvalRequestId: null,
      },
      decision: { action, targetState, reason, bankReference },
    },
  };
}
