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
