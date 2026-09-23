import { describe, expect, it } from 'vitest';
import { calculateElectricityPriceAdjustment } from './electricity-price-adjustment.calculation.js';

const start = new Date('2026-10-01T00:00:00Z');
const middle = new Date('2026-10-06T00:00:00Z');
const end = new Date('2026-10-11T00:00:00Z');
const original = {
  source: 'original_invoice' as const,
  invoiceId: 'original',
  amountIrR: 1_000_000n,
  periodStart: start,
  periodEnd: end,
};

describe('electricity price adjustment calculation', () => {
  it('charges only the future half of the paid original value', () => {
    const result = calculateElectricityPriceAdjustment([original], middle, 1_000n);
    expect(result).toMatchObject({ amountIrR: 50_000n, kind: 'charge' });
    expect(result.components[0]).toMatchObject({
      oldFutureIrR: '500000',
      changeIrR: '50000',
      newFutureIrR: '550000',
    });
  });

  it('creates a credit for a decrease and never a negative invoice amount', () => {
    const result = calculateElectricityPriceAdjustment([original], middle, -1_000n);
    expect(result).toMatchObject({ amountIrR: -50_000n, kind: 'credit' });
  });

  it('prices a paid quantity increase only over its own eligible future term', () => {
    const result = calculateElectricityPriceAdjustment(
      [
        original,
        {
          source: 'quantity_increase',
          invoiceId: 'increase',
          amountIrR: 200_000n,
          periodStart: middle,
          periodEnd: end,
        },
      ],
      new Date('2026-10-08T12:00:00Z'),
      1_000n
    );
    expect(result.amountIrR).toBe(35_000n);
    expect(result.components.map((component) => component.changeIrR)).toEqual(['25000', '10000']);
  });

  it('compounds a later change over an earlier price credit without rewriting that credit', () => {
    const result = calculateElectricityPriceAdjustment(
      [
        original,
        {
          source: 'price_adjustment',
          invoiceId: 'previous-credit',
          amountIrR: -50_000n,
          periodStart: middle,
          periodEnd: end,
        },
      ],
      new Date('2026-10-08T12:00:00Z'),
      1_000n
    );
    expect(result.amountIrR).toBe(22_500n);
    expect(result.oldFutureIrR).toBe(225_000n);
  });

  it('rejects elapsed periods, a zero change and a decrease to zero price', () => {
    expect(() => calculateElectricityPriceAdjustment([original], end, 1_000n)).toThrow();
    expect(() => calculateElectricityPriceAdjustment([original], middle, 0n)).toThrow();
    expect(() => calculateElectricityPriceAdjustment([original], middle, -10_000n)).toThrow();
  });
});
