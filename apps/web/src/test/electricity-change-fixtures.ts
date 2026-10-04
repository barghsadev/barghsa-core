import { createHash } from 'node:crypto';

export const changeContractId = '11111111-1111-4111-8111-111111111111';
export const changeProfileId = '22222222-2222-4222-8222-222222222222';
export const changeVersionId = '33333333-3333-4333-8333-333333333333';
const invoiceId = '44444444-4444-4444-8444-444444444444';
const orderId = '55555555-5555-4555-8555-555555555555';
export const changeCursor = '88888888-8888-4888-8888-888888888888';
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
  const periodStart = '2026-09-01T00:00:00.000Z';
  const periodEnd = '2027-09-01T00:00:00.000Z';
  const eligibleFrom = new Date(
    Math.max(Date.parse(periodStart), Date.parse(input.effectiveFrom))
  ).toISOString();
  const periodMs = BigInt(Date.parse(periodEnd) - Date.parse(periodStart));
  const remainingMs = BigInt(Math.max(0, Date.parse(periodEnd) - Date.parse(eligibleFrom)));
  const rounded = (value: bigint, divisor: bigint) =>
    value < 0n ? -((-value + divisor / 2n) / divisor) : (value + divisor / 2n) / divisor;
  const oldFutureIrR = rounded(1_000_000n * remainingMs, periodMs);
  const amountIrR = rounded(
    1_000_000n * BigInt(input.percentageBps) * remainingMs,
    10_000n * periodMs
  );
  const newFutureIrR = oldFutureIrR + amountIrR;
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
      periodStart,
      periodEnd,
      calculation: {
        schemaVersion: 1,
        contractId: changeContractId,
        versionId: changeVersionId,
        originalInvoiceId: invoiceId,
        reason: input.reason,
        contractualBasis: input.contractualBasis,
        quote: {
          amountIrR: amountIrR.toString(),
          oldFutureIrR: oldFutureIrR.toString(),
          newFutureIrR: newFutureIrR.toString(),
          kind: amountIrR > 0n ? 'charge' : 'credit',
          percentageBps: input.percentageBps,
          effectiveFrom: input.effectiveFrom,
          rounding: 'half-up-to-nearest-IRR',
          components: [
            {
              source: 'original_invoice',
              invoiceId,
              basisIrR: '1000000',
              periodStart,
              periodEnd,
              eligibleFrom,
              oldFutureIrR: oldFutureIrR.toString(),
              changeIrR: amountIrR.toString(),
              newFutureIrR: newFutureIrR.toString(),
              remainingMs: remainingMs.toString(),
              periodMs: periodMs.toString(),
            },
          ],
        },
      },
    },
  };
}
const priceCalculation = priceReview({
  reason: 'Published tariff',
  contractualBasis: 'Clause 7',
  effectiveFrom: increaseRow.effectiveFrom,
  percentageBps: '1000',
}).data.calculation;
export const priceRow = {
  adjustmentId: '77777777-7777-4777-8777-777777777777',
  contractId: changeContractId,
  status: 'proposed' as const,
  effectiveFrom: increaseRow.effectiveFrom,
  periodEnd: increaseRow.periodEnd,
  percentageBps: '1000',
  reason: 'Published tariff',
  contractualBasis: 'Clause 7',
  adjustmentAmountIrR: priceCalculation.quote.amountIrR,
  calculationSha256: createHash('sha256').update(JSON.stringify(priceCalculation)).digest('hex'),
  adjustmentInvoiceId: null,
  adjustmentInvoiceState: null,
  proposedAt: '2026-09-30T00:00:00.000Z',
  finalizedAt: null,
  cancelledAt: null,
  calculation: priceCalculation,
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
