export function increaseDecisionFixture() {
  const requestId = '11111111-1111-7111-8111-111111111111';
  const profileId = '22222222-2222-7222-8222-222222222222';
  const contractId = '33333333-3333-7333-8333-333333333333';
  const orderId = '44444444-4444-7444-8444-444444444444';
  const versionId = '55555555-5555-7555-8555-555555555555';
  const invoiceId = '66666666-6666-7666-8666-666666666666';
  const effectiveFrom = '2026-10-01T00:00:00.000Z';
  const request = {
    requestId,
    profileId,
    contractId,
    orderId,
    versionId,
    originalKwh: '10',
    requestedKwh: '12',
    maxPercentage: 20,
    effectiveFrom,
    periodEnd: '2026-10-15T00:00:00.000Z',
    createdAt: '2026-09-30T00:00:00.000Z',
    contractState: 'Active',
    status: 'pending',
    adjustmentInvoiceId: null,
    adjustmentInvoiceState: null,
    adjustmentPaidAmount: null,
    financialFollowUp: false,
  };
  const decisionReview = (
    action: 'approve' | 'reject',
    reason = action === 'approve' ? 'Capacity reviewed' : 'Outside capacity plan',
    effective = effectiveFrom
  ) => ({
    schemaVersion: 1,
    scope: {
      action: 'electricity.quantity-increase-staff-decision',
      profileId,
      resourceId: requestId,
    },
    data: {
      action,
      reason,
      requestId,
      contractId,
      orderId,
      profileId,
      versionId,
      contractState: 'Active',
      electricityStatus: 'active',
      originalKwh: '10',
      requestedKwh: '12',
      incrementalKwh: '2',
      maxPercentageAtRequest: 20,
      maxPercentageAtDecision: action === 'approve' ? 20 : null,
      requestedEffectiveFrom: effectiveFrom,
      effectiveFrom: action === 'approve' ? effective : null,
      periodStart: '2026-09-15T00:00:00.000Z',
      periodEnd: request.periodEnd,
      originalInvoiceId: invoiceId,
      originalInvoiceState: 'Paid',
      originalInvoiceTotalIrR: '100000',
      originalInvoicePaidIrR: '100000',
      originalInvoiceRefundedIrR: '0',
      outcome:
        action === 'approve'
          ? 'publish_amendment_for_customer_signature'
          : 'reject_without_adjustment',
      adjustmentRule: 'prorated_at_customer_signature',
    },
    hash: (action === 'approve' ? 'a' : 'b').repeat(64),
  });
  const receipt = async (
    action: 'approve' | 'reject',
    reason = action === 'approve' ? 'Capacity reviewed' : 'Outside capacity plan',
    effective = effectiveFrom
  ) => {
    const row = {
      ...request,
      effectiveFrom: action === 'approve' ? effective : effectiveFrom,
      status: action === 'approve' ? 'awaiting_signature' : 'rejected',
      requestedBy: 'customer-1',
      reviewedBy: 'staff-1',
      reviewedAt: '2026-09-30T12:00:00.000Z',
      reviewReason: reason || null,
      amendmentDocument: null as Record<string, unknown> | null,
      amendmentSha256: null as string | null,
      signatureEvidence: null,
      signedAt: null,
      pricingSnapshot: null,
      adjustmentAmount: null,
      effectiveAt: null,
      expiredAt: null,
    };
    if (action === 'approve') {
      row.amendmentDocument = {
        schemaVersion: 1,
        kind: 'electricity_quantity_increase',
        requestId,
        contractId,
        orderId,
        contractVersionId: versionId,
        requestedBy: row.requestedBy,
        approvedBy: row.reviewedBy,
        approvedAt: row.reviewedAt,
        ...(reason ? { approvalReason: reason } : {}),
        originalKwh: '10',
        requestedKwh: '12',
        incrementalKwh: '2',
        increaseBasisPoints: '2000',
        maxPercentageAtRequest: 20,
        maxPercentageAtApproval: 20,
        earliestEffectiveFrom: effective,
        periodEnd: request.periodEnd,
        pricingRule:
          'Paid original invoice and finalized price adjustments, prorated for the added quantity over each remaining eligible period at signature',
        activationRule:
          'Quantity increases only after customer signature and full adjustment payment, no earlier than the effective date',
      };
      const canonical = JSON.stringify(
        Object.fromEntries(
          Object.entries(row.amendmentDocument).sort(([left], [right]) => left.localeCompare(right))
        )
      );
      const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(canonical));
      row.amendmentSha256 = [...new Uint8Array(digest)]
        .map((byte) => byte.toString(16).padStart(2, '0'))
        .join('');
    }
    return row;
  };
  return { request, decisionReview, receipt };
}
