import { expect, it } from 'vitest';
import { parseElectricityIncreaseSigningReview } from './electricity-increase-signing-review.js';

const contractId = '11111111-1111-4111-8111-111111111111';
const profileId = '22222222-2222-4222-8222-222222222222';
const start = '2026-09-01T00:00:00.000Z';
const eligible = '2026-09-24T00:00:00.000Z';
const end = '2026-10-24T00:00:00.000Z';

function review() {
  return {
    schemaVersion: 1,
    hash: 'a'.repeat(64),
    scope: { action: 'electricity.quantity-increase-sign', profileId, resourceId: contractId },
    data: {
      currency: 'IRR',
      profileId,
      contractId,
      orderId: '33333333-3333-4333-8333-333333333333',
      versionId: '44444444-4444-4444-8444-444444444444',
      requestId: '55555555-5555-4555-8555-555555555555',
      amendmentSha256: 'b'.repeat(64),
      originalInvoiceId: '66666666-6666-4666-8666-666666666666',
      originalInvoiceIrR: '1000000',
      originalKwh: '100',
      requestedKwh: '120',
      incrementalKwh: '20',
      effectiveFrom: eligible,
      eligibleFrom: eligible,
      periodStart: start,
      periodEnd: end,
      remainingMs: String(Date.parse(end) - Date.parse(eligible)),
      periodMs: String(Date.parse(end) - Date.parse(start)),
      baseShareIrR: '190000',
      priceAdjustments: [
        {
          invoiceId: '77777777-7777-4777-8777-777777777777',
          amountIrR: '50000',
          effectiveFrom: eligible,
          increaseShareIrR: '10000',
        },
      ],
      adjustmentIrR: '200000',
      activationRule: 'after-signature-full-payment-and-effective-date',
    },
  };
}

it('accepts a scoped and reconciled increase-signing review', () => {
  expect(parseElectricityIncreaseSigningReview(review())?.data.adjustmentIrR).toBe('200000');
});

it('rejects a changed owner, price sum, quantity, or delivery duration', () => {
  const owner = review();
  owner.scope.profileId = contractId;
  expect(parseElectricityIncreaseSigningReview(owner)).toBeNull();
  const sum = review();
  sum.data.priceAdjustments[0]!.increaseShareIrR = '10001';
  expect(parseElectricityIncreaseSigningReview(sum)).toBeNull();
  const quantity = review();
  quantity.data.incrementalKwh = '21';
  expect(parseElectricityIncreaseSigningReview(quantity)).toBeNull();
  const duration = review();
  duration.data.remainingMs = '1';
  expect(parseElectricityIncreaseSigningReview(duration)).toBeNull();
});
