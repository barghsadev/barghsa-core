export const changeContractId = '11111111-1111-4111-8111-111111111111';
export const changeProfileId = '22222222-2222-4222-8222-222222222222';
export const changeVersionId = '33333333-3333-4333-8333-333333333333';
const invoiceId = '44444444-4444-4444-8444-444444444444';
const orderId = '55555555-5555-4555-8555-555555555555';
export const changeCursor = '2026-10-01T00:00:00.123456Z';
export const increaseRow = {
  requestId: '66666666-6666-4666-8666-666666666666',
  profileId: changeProfileId,
  contractId: changeContractId,
  versionId: changeVersionId,
  orderId,
  originalKwh: '10',
  requestedKwh: '12',
  maxPercentage: 20,
  effectiveFrom: '2026-10-06T12:00:00.000Z',
  periodEnd: '2027-09-01T00:00:00.000Z',
  createdAt: '2026-09-30T00:00:00.000Z',
  contractState: 'Active',
  status: 'pending',
  adjustmentInvoiceId: null,
  adjustmentInvoiceState: null,
  adjustmentPaidAmount: null,
  financialFollowUp: false,
};
export function increaseReview(
  decision: 'approve' | 'reject',
  reason = '',
  effectiveFrom = increaseRow.effectiveFrom
) {
  return {
    schemaVersion: 1,
    hash: 'a'.repeat(64),
    scope: {
      action: 'electricity.quantity-increase-staff-decision',
      profileId: changeProfileId,
      resourceId: increaseRow.requestId,
    },
    data: {
      action: decision,
      reason: decision === 'reject' ? reason : '',
      requestId: increaseRow.requestId,
      profileId: changeProfileId,
      contractId: changeContractId,
      versionId: changeVersionId,
      orderId,
      contractState: increaseRow.contractState,
      originalKwh: increaseRow.originalKwh,
      requestedKwh: increaseRow.requestedKwh,
      periodEnd: increaseRow.periodEnd,
      electricityStatus: 'active',
      incrementalKwh: '2',
      maxPercentageAtRequest: 20,
      maxPercentageAtDecision: decision === 'approve' ? 20 : null,
      requestedEffectiveFrom: increaseRow.effectiveFrom,
      effectiveFrom: decision === 'approve' ? effectiveFrom : null,
      periodStart: '2026-09-01T00:00:00.000Z',
      originalInvoiceId: invoiceId,
      originalInvoiceState: 'Paid',
      originalInvoiceTotalIrR: '100000',
      originalInvoicePaidIrR: '100000',
      originalInvoiceRefundedIrR: '0',
      outcome:
        decision === 'approve'
          ? 'publish_amendment_for_customer_signature'
          : 'reject_without_adjustment',
      adjustmentRule: 'prorated_at_customer_signature',
    },
  };
}
export function priceReview(input: {
  reason: string;
  contractualBasis: string;
  effectiveFrom: string;
  percentageBps: string;
}) {
  return {
    schemaVersion: 1,
    hash: 'b'.repeat(64),
    scope: {
      action: 'electricity.price-adjustment-proposal',
      profileId: changeProfileId,
      resourceId: changeContractId,
    },
    data: {
      currency: 'IRR',
      profileId: changeProfileId,
      orderId,
      periodStart: '2026-09-01T00:00:00.000Z',
      periodEnd: '2027-09-01T00:00:00.000Z',
      calculation: {
        schemaVersion: 1,
        contractId: changeContractId,
        versionId: changeVersionId,
        originalInvoiceId: invoiceId,
        reason: input.reason,
        contractualBasis: input.contractualBasis,
        quote: {
          amountIrR: '50000',
          oldFutureIrR: '500000',
          newFutureIrR: '550000',
          kind: 'charge',
          percentageBps: input.percentageBps,
          effectiveFrom: input.effectiveFrom,
          rounding: 'half-up-to-nearest-IRR',
          components: [
            {
              source: 'original_invoice',
              invoiceId,
              basisIrR: '1000000',
              periodStart: '2026-09-01T00:00:00.000Z',
              periodEnd: '2027-09-01T00:00:00.000Z',
              eligibleFrom: input.effectiveFrom,
              oldFutureIrR: '500000',
              changeIrR: '50000',
              newFutureIrR: '550000',
              remainingMs: '15897600000',
              periodMs: '31536000000',
            },
          ],
        },
      },
    },
  };
}
export const priceRow = {
  adjustmentId: '77777777-7777-4777-8777-777777777777',
  status: 'proposed' as const,
  effectiveFrom: increaseRow.effectiveFrom,
  percentageBps: '1000',
  reason: 'Published tariff',
  contractualBasis: 'Clause 7',
  adjustmentAmountIrR: '50000',
  calculationSha256: 'c'.repeat(64),
  adjustmentInvoiceId: null,
  calculation: priceReview({
    reason: 'Published tariff',
    contractualBasis: 'Clause 7',
    effectiveFrom: increaseRow.effectiveFrom,
    percentageBps: '1000',
  }).data.calculation,
};
export const priceState = {
  contractId: changeContractId,
  profileId: changeProfileId,
  versionId: changeVersionId,
  periodEnd: '2027-09-01T00:00:00.000Z',
  canPropose: true,
  canCancel: true,
  canFinalize: true,
  blockedByIncrease: false,
  adjustments: [] as (typeof priceRow)[],
};
