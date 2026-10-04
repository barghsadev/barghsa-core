import { expect, it } from 'vitest';
import {
  parseElectricityPriceAdjustmentRow,
  sameElectricityPriceCalculation,
} from './electricity-price-adjustment-row.js';
import {
  priceAdjustmentRow,
  priceCalculation,
} from '../test/electricity-price-adjustment-fixtures.js';

it.each(['proposed', 'finalized', 'cancelled'] as const)(
  'accepts the complete persisted %s row without treating its historical version as current',
  (status) => {
    const row = priceAdjustmentRow(status);
    expect(parseElectricityPriceAdjustmentRow(row)).toBe(row);
    row.calculation.versionId = '77777777-7777-4777-8777-777777777777';
    expect(parseElectricityPriceAdjustmentRow(row)).toBe(row);
  }
);

it('requires the complete public row and calculation, with identities and disclosed values bound', () => {
  const valid = priceAdjustmentRow();
  for (const altered of [
    { ...valid, proposedAt: undefined },
    { ...valid, contractId: '77777777-7777-4777-8777-777777777777' },
    { ...valid, adjustmentId: 'private-id' },
    { ...valid, adjustmentAmountIrR: '-50001' },
    { ...valid, reason: 'Unrelated reason' },
    { ...valid, calculationSha256: 'unsafe digest' },
    { ...valid, calculation: { quote: valid.calculation.quote } },
  ])
    expect(parseElectricityPriceAdjustmentRow(altered)).toBeNull();
});

it('rejects incoherent totals, component durations and line arithmetic before financial display', () => {
  const valid = priceAdjustmentRow();
  for (const change of [
    (row: typeof valid) => {
      row.calculation.quote.oldFutureIrR = '500001';
    },
    (row: typeof valid) => {
      row.calculation.quote.components[0]!.periodMs = '1';
    },
    (row: typeof valid) => {
      row.calculation.quote.components[0]!.remainingMs = '1';
    },
    (row: typeof valid) => {
      row.calculation.quote.components[0]!.newFutureIrR = '450001';
    },
    (row: typeof valid) => {
      row.calculation.quote.components[0]!.invoiceId = '77777777-7777-4777-8777-777777777777';
    },
    (row: typeof valid) => {
      row.calculation.quote.kind = 'charge';
    },
  ]) {
    const altered = structuredClone(valid);
    change(altered);
    expect(parseElectricityPriceAdjustmentRow(altered)).toBeNull();
  }
});

it('requires reached-stage invoice and timestamp evidence without inventing a customer receipt', () => {
  const finalized = priceAdjustmentRow('finalized');
  const cancelled = priceAdjustmentRow('cancelled');
  for (const altered of [
    { ...finalized, adjustmentInvoiceState: null },
    { ...finalized, adjustmentInvoiceId: null },
    { ...finalized, finalizedAt: null },
    { ...cancelled, cancelledAt: null },
    { ...cancelled, adjustmentInvoiceId: finalized.adjustmentInvoiceId },
    { ...priceAdjustmentRow(), finalizedAt: finalized.finalizedAt },
  ])
    expect(parseElectricityPriceAdjustmentRow(altered)).toBeNull();
});

it('allows exhausted historical components whose eligibility is after their component end', () => {
  const row = priceAdjustmentRow();
  row.calculation.quote.components.push({
    ...row.calculation.quote.components[0]!,
    source: 'price_adjustment',
    invoiceId: '77777777-7777-4777-8777-777777777777',
    periodStart: '2026-08-01T00:00:00.000Z',
    periodEnd: '2026-09-01T00:00:00.000Z',
    periodMs: String(Date.parse('2026-09-01') - Date.parse('2026-08-01')),
    remainingMs: '0',
    oldFutureIrR: '0',
    changeIrR: '0',
    newFutureIrR: '0',
  });
  expect(parseElectricityPriceAdjustmentRow(row)).toBe(row);
});

it('compares JSONB calculations semantically while preserving each primitive and component order', () => {
  const expected = priceCalculation();
  const reordered = {
    ...expected,
    quote: {
      ...expected.quote,
      components: expected.quote.components.map((component) =>
        Object.fromEntries(Object.entries(component).reverse())
      ),
    },
  };
  const parsed = parseElectricityPriceAdjustmentRow({
    ...priceAdjustmentRow(),
    calculation: reordered,
  });
  expect(parsed).not.toBeNull();
  expect(sameElectricityPriceCalculation(parsed!.calculation, expected)).toBe(true);
  const altered = structuredClone(expected);
  altered.quote.components[0]!.basisIrR = '999999';
  expect(sameElectricityPriceCalculation(altered, expected)).toBe(false);
  const second = {
    ...expected.quote.components[0]!,
    source: 'quantity_increase' as const,
    invoiceId: '77777777-7777-4777-8777-777777777777',
  };
  expected.quote.components.push(second);
  const swapped = structuredClone(expected);
  swapped.quote.components.reverse();
  expect(sameElectricityPriceCalculation(swapped, expected)).toBe(false);
});
