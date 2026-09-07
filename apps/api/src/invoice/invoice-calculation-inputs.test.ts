import { describe, expect, it } from 'vitest';
import { calculateManualInvoice } from './manual-invoice.calculation.js';
import { calculateAutoInvoice } from './auto-invoice.calculation.js';
import {
  buildManualInvoiceCalculationSnapshot,
  buildAutoInvoiceCalculationSnapshot,
  replayInvoiceCalculation,
  INVOICE_ROUNDING_RULE,
  VAT_BASIS_POINT_SCALE,
  type InvoiceCalculationSnapshot,
} from './invoice-calculation-snapshot.js';

const manualLine = { description: 'Calculation boundary', quantity: 1, unitPrice: 1n, vatRate: 0 };
const autoLine = { ...manualLine, productId: 'product-one', productType: 'electricity' };

function snapshot(source: 'manual' | 'auto'): InvoiceCalculationSnapshot {
  return source === 'manual'
    ? buildManualInvoiceCalculationSnapshot([manualLine], calculateManualInvoice([manualLine]))
    : buildAutoInvoiceCalculationSnapshot([autoLine], 0n, calculateAutoInvoice([autoLine]));
}

for (const source of ['manual', 'auto'] as const) {
  describe(`${source} calculation input boundaries`, () => {
    const calculate = (quantity: number) =>
      source === 'manual'
        ? calculateManualInvoice([{ ...manualLine, quantity }])
        : calculateAutoInvoice([{ ...autoLine, quantity }]);

    it.each([Number.MAX_SAFE_INTEGER + 1, 1e20])(
      'rejects unsafe numeric quantity %s',
      (quantity) => {
        expect(() => calculate(quantity)).toThrow(RangeError);
      }
    );

    it('retains exact arithmetic at the safe integer boundary', () => {
      expect(calculate(Number.MAX_SAFE_INTEGER).totalAmount).toBe(9007199254740991n);
    });

    it('rejects an unsafe quantity read from a JSON snapshot', () => {
      const stored = snapshot(source);
      stored.inputs.lines[0]!.quantity = Number.MAX_SAFE_INTEGER + 1;
      const readBack: InvoiceCalculationSnapshot = JSON.parse(JSON.stringify(stored));
      expect(() => replayInvoiceCalculation(readBack)).toThrow(RangeError);
    });

    for (const [label, patch] of [
      ['future version', { version: 2 }],
      ['missing version', { version: undefined }],
      ['missing rounding', { rounding: undefined }],
      [
        'different rounding rule',
        { rounding: { rule: 'half-even', vatScale: VAT_BASIS_POINT_SCALE } },
      ],
      ['different VAT scale', { rounding: { rule: INVOICE_ROUNDING_RULE, vatScale: 100 } }],
      ['non-numeric VAT scale', { rounding: { rule: INVOICE_ROUNDING_RULE, vatScale: '10000' } }],
    ] as const) {
      it(`rejects ${label} instead of assuming current arithmetic`, () => {
        const stored = { ...snapshot(source), ...patch } as unknown as InvoiceCalculationSnapshot;
        expect(() => replayInvoiceCalculation(stored)).toThrow(/unsupported snapshot/);
      });
    }
  });
}

it.each(['1', '-1', 0])('rejects unsupported manual discount %s', (discount) => {
  const stored = snapshot('manual');
  Object.assign(stored.inputs, { orderDiscount: discount });
  expect(() => replayInvoiceCalculation(stored)).toThrow(RangeError);
});

it.each([null, undefined])('rejects a missing snapshot document: %s', (stored) => {
  expect(() => replayInvoiceCalculation(stored as unknown as InvoiceCalculationSnapshot)).toThrow(
    /unsupported snapshot/
  );
});
