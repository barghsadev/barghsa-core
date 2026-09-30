import { expect, it } from 'vitest';
import { parseElectricityPriceAdjustmentReview } from './electricity-price-adjustment-review.js';

const contractId = '11111111-1111-4111-8111-111111111111';
const profileId = '22222222-2222-4222-8222-222222222222';
const invoiceId = '33333333-3333-4333-8333-333333333333';
const versionId = '44444444-4444-4444-8444-444444444444';
const orderId = '55555555-5555-4555-8555-555555555555';
const periodStart = '2026-09-01T00:00:00.000Z';
const periodEnd = '2027-09-01T00:00:00.000Z';
const effectiveFrom = '2027-03-01T00:00:00.000Z';

function review() {
  return {
    schemaVersion: 1,
    hash: 'a'.repeat(64),
    scope: {
      action: 'electricity.price-adjustment-proposal',
      profileId,
      resourceId: contractId,
    },
    data: {
      currency: 'IRR',
      profileId,
      orderId,
      periodStart,
      periodEnd,
      calculation: {
        schemaVersion: 1,
        contractId,
        versionId,
        originalInvoiceId: invoiceId,
        reason: 'Tariff change',
        contractualBasis: 'Clause 7',
        quote: {
          amountIrR: '50000',
          oldFutureIrR: '500000',
          newFutureIrR: '550000',
          kind: 'charge',
          percentageBps: '1000',
          effectiveFrom,
          rounding: 'half-up-to-nearest-IRR',
          components: [
            {
              source: 'original_invoice',
              invoiceId,
              basisIrR: '1000000',
              periodStart,
              periodEnd,
              eligibleFrom: effectiveFrom,
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

it('accepts an exact scoped price review', () => {
  expect(parseElectricityPriceAdjustmentReview(review())?.data.calculation.quote.amountIrR).toBe(
    '50000'
  );
});

it('rejects changed scope, inconsistent totals, and an incomplete price basis', () => {
  const wrongScope = review();
  wrongScope.scope.profileId = invoiceId;
  expect(parseElectricityPriceAdjustmentReview(wrongScope)).toBeNull();
  const wrongTotal = review();
  wrongTotal.data.calculation.quote.newFutureIrR = '550001';
  expect(parseElectricityPriceAdjustmentReview(wrongTotal)).toBeNull();
  const emptyBasis = review();
  emptyBasis.data.calculation.quote.components = [];
  expect(parseElectricityPriceAdjustmentReview(emptyBasis)).toBeNull();
  const wrongComponent = review();
  wrongComponent.data.calculation.quote.components[0]!.changeIrR = '50001';
  expect(parseElectricityPriceAdjustmentReview(wrongComponent)).toBeNull();
});
