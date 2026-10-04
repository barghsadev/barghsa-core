import type {
  ElectricityPriceAdjustmentCalculation,
  ElectricityPriceAdjustmentRow,
} from '../lib/electricity-price-adjustment-row.js';

export const priceContractId = '11111111-1111-4111-8111-111111111111';
export const priceProfileId = '22222222-2222-4222-8222-222222222222';
export const priceVersionId = '33333333-3333-4333-8333-333333333333';
export const priceOriginalInvoiceId = '44444444-4444-4444-8444-444444444444';
export const priceAdjustmentId = '55555555-5555-4555-8555-555555555555';
export const priceAdjustmentInvoiceId = '66666666-6666-4666-8666-666666666666';

export function priceCalculation(
  kind: 'credit' | 'charge' = 'credit'
): ElectricityPriceAdjustmentCalculation {
  const effectiveFrom = '2026-10-02T00:00:00.000Z';
  const periodStart = '2026-09-01T00:00:00.000Z';
  const periodEnd = '2026-11-02T00:00:00.000Z';
  const amountIrR = kind === 'credit' ? '-50000' : '50000';
  const newFutureIrR = kind === 'credit' ? '450000' : '550000';
  return {
    schemaVersion: 1,
    contractId: priceContractId,
    versionId: priceVersionId,
    originalInvoiceId: priceOriginalInvoiceId,
    reason: 'Published tariff correction',
    contractualBasis: 'Clause 7',
    quote: {
      amountIrR,
      oldFutureIrR: '500000',
      newFutureIrR,
      kind,
      percentageBps: kind === 'credit' ? '-1000' : '1000',
      effectiveFrom,
      rounding: 'half-up-to-nearest-IRR',
      components: [
        {
          source: 'original_invoice',
          invoiceId: priceOriginalInvoiceId,
          basisIrR: '1000000',
          periodStart,
          periodEnd,
          eligibleFrom: effectiveFrom,
          oldFutureIrR: '500000',
          changeIrR: amountIrR,
          newFutureIrR,
          remainingMs: String(Date.parse(periodEnd) - Date.parse(effectiveFrom)),
          periodMs: String(Date.parse(periodEnd) - Date.parse(periodStart)),
        },
      ],
    },
  };
}

export function priceAdjustmentRow(
  status: ElectricityPriceAdjustmentRow['status'] = 'proposed',
  kind: 'credit' | 'charge' = 'credit'
): ElectricityPriceAdjustmentRow {
  const calculation = priceCalculation(kind);
  return {
    adjustmentId: priceAdjustmentId,
    contractId: priceContractId,
    status,
    effectiveFrom: calculation.quote.effectiveFrom,
    periodEnd: calculation.quote.components[0]!.periodEnd,
    percentageBps: calculation.quote.percentageBps,
    reason: calculation.reason,
    contractualBasis: calculation.contractualBasis,
    calculation,
    calculationSha256: 'a'.repeat(64),
    adjustmentAmountIrR: calculation.quote.amountIrR,
    adjustmentInvoiceId: status === 'finalized' ? priceAdjustmentInvoiceId : null,
    adjustmentInvoiceState: status === 'finalized' ? 'Unpaid' : null,
    proposedAt: '2026-09-24T00:00:00.000Z',
    finalizedAt: status === 'finalized' ? '2026-09-25T00:00:00.000Z' : null,
    cancelledAt: status === 'cancelled' ? '2026-09-25T00:00:00.000Z' : null,
  };
}
