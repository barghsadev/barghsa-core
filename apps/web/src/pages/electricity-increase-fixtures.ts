import type { ElectricityIncreaseRow } from '../lib/electricity-increase-form.js';
import type { ElectricityIncreaseSigningReview } from '@barghsa/shared/finance';

export const contractId = '11111111-1111-4111-8111-111111111111';
export const versionId = '22222222-2222-4222-8222-222222222222';
export const profileId = '33333333-3333-4333-8333-333333333333';
export const requestId = '44444444-4444-4444-8444-444444444444';
export const invoiceId = '55555555-5555-4555-8555-555555555555';
export const orderId = '66666666-6666-4666-8666-666666666666';
export const periodStart = '2026-09-01T00:00:00.000Z';
export const periodEnd = '2026-10-24T00:00:00.000Z';
export const eligibleFrom = '2026-09-24T00:00:00.000Z';

export function signingReview(): ElectricityIncreaseSigningReview {
  return {
    schemaVersion: 1,
    hash: 'b'.repeat(64),
    scope: { action: 'electricity.quantity-increase-sign', profileId, resourceId: contractId },
    data: {
      currency: 'IRR',
      profileId,
      contractId,
      orderId,
      versionId,
      requestId,
      amendmentSha256: 'a'.repeat(64),
      originalInvoiceId: invoiceId,
      originalInvoiceIrR: '1000000',
      originalKwh: '100',
      requestedKwh: '120',
      incrementalKwh: '20',
      effectiveFrom: eligibleFrom,
      eligibleFrom,
      periodStart,
      periodEnd,
      remainingMs: String(Date.parse(periodEnd) - Date.parse(eligibleFrom)),
      periodMs: String(Date.parse(periodEnd) - Date.parse(periodStart)),
      baseShareIrR: '200000',
      priceAdjustments: [],
      adjustmentIrR: '200000',
      activationRule: 'after-signature-full-payment-and-effective-date',
    },
  };
}

export function requestRow(
  overrides: Partial<ElectricityIncreaseRow> = {}
): ElectricityIncreaseRow {
  return {
    requestId,
    contractId,
    orderId,
    profileId,
    versionId,
    originalKwh: '100',
    requestedKwh: '120',
    maxPercentage: 20,
    effectiveFrom: eligibleFrom,
    periodEnd,
    status: 'pending',
    reviewReason: null,
    createdAt: eligibleFrom,
    reviewedAt: null,
    reviewedBy: null,
    requestedBy: 'customer',
    amendmentSha256: null,
    amendmentDocument: null,
    signatureEvidence: null,
    signedAt: null,
    pricingSnapshot: null,
    adjustmentInvoiceId: null,
    adjustmentAmount: null,
    effectiveAt: null,
    expiredAt: null,
    adjustmentInvoiceState: null,
    adjustmentPaidAmount: null,
    financialFollowUp: false,
    contractState: 'Active',
    ...overrides,
  };
}
export function amendment() {
  return {
    schemaVersion: 1,
    kind: 'electricity_quantity_increase',
    requestId,
    contractId,
    orderId,
    contractVersionId: versionId,
    requestedBy: 'customer',
    approvedBy: 'staff',
    approvedAt: eligibleFrom,
    originalKwh: '100',
    requestedKwh: '120',
    incrementalKwh: '20',
    increaseBasisPoints: '2000',
    maxPercentageAtRequest: 20,
    maxPercentageAtApproval: 20,
    earliestEffectiveFrom: eligibleFrom,
    periodEnd,
    pricingRule:
      'Paid original invoice and finalized price adjustments, prorated for the added quantity over each remaining eligible period at signature',
    activationRule:
      'Quantity increases only after customer signature and full adjustment payment, no earlier than the effective date',
  };
}
export function signatureRow(overrides: Partial<ElectricityIncreaseRow> = {}) {
  const review = signingReview();
  return requestRow({
    status: 'awaiting_payment',
    reviewedAt: eligibleFrom,
    reviewedBy: 'staff',
    amendmentSha256: 'a'.repeat(64),
    amendmentDocument: amendment(),
    signedAt: eligibleFrom,
    adjustmentInvoiceId: invoiceId,
    adjustmentAmount: '200000',
    adjustmentInvoiceState: 'Unpaid',
    adjustmentPaidAmount: '0',
    signatureEvidence: {
      schemaVersion: 1,
      amendmentSha256: 'a'.repeat(64),
      signedBy: 'customer',
      sessionId: versionId,
      signedAt: eligibleFrom,
      ip: '127.0.0.1',
      adjustmentIrR: '200000',
    },
    pricingSnapshot: {
      schemaVersion: 1,
      amendmentSha256: 'a'.repeat(64),
      originalInvoiceId: invoiceId,
      originalInvoiceIrR: '1000000',
      originalKwh: '100',
      requestedKwh: '120',
      eligibleFrom,
      periodStart,
      periodEnd,
      remainingMs: review.data.remainingMs,
      periodMs: review.data.periodMs,
      priceAdjustments: [],
      rounding: 'half-up-to-nearest-IRR',
      adjustmentIrR: '200000',
      financialReview: review,
    },
    ...overrides,
  });
}

export function eligibleState() {
  return {
    request: null,
    canRequest: true,
    maxPercentage: 20,
    originalKwh: '100',
    quote: null,
    review: null,
  };
}
export function signingState() {
  return {
    request: requestRow({
      status: 'awaiting_signature',
      reviewedAt: eligibleFrom,
      reviewedBy: 'staff',
      amendmentDocument: amendment(),
      amendmentSha256: 'a'.repeat(64),
    }),
    canRequest: false,
    maxPercentage: 20,
    originalKwh: '100',
    quote: { adjustmentIrR: '200000', eligibleFrom },
    review: signingReview(),
  };
}
