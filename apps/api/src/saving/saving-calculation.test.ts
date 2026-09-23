import { describe, expect, it } from 'vitest';
import { calculateSavingTotals, type SavingPriceLine } from './saving-calculation.js';

const lines: [SavingPriceLine, SavingPriceLine] = [
  {
    type: 'plan_price',
    productId: 'plan',
    title: { fa: 'طرح', en: 'Plan' },
    amountIrR: 100_000n,
    vatRateBps: 900,
  },
  {
    type: 'hardware_price',
    productId: 'hardware',
    title: { fa: 'تجهیز', en: 'Hardware' },
    amountIrR: 200_000n,
    vatRateBps: 0,
  },
];

describe('saving order totals', () => {
  it('allocates one discount across products and taxes only each net line', () => {
    const result = calculateSavingTotals(lines, 30_000n);
    expect(result.lines.map((line) => line.discountIrR)).toEqual([10_000n, 20_000n]);
    expect(result.lines.map((line) => line.vatIrR)).toEqual([8_100n, 0n]);
    expect(result.totalIrR).toBe(278_100n);
  });

  it('uses deterministic largest-remainder allocation without losing a rial', () => {
    const result = calculateSavingTotals(
      [
        { ...lines[0], amountIrR: 1n, vatRateBps: 0 },
        { ...lines[1], amountIrR: 2n },
      ],
      2n
    );
    expect(result.lines.map((line) => line.discountIrR)).toEqual([1n, 1n]);
    expect(result.totalIrR).toBe(1n);
  });

  it('rejects discounts exceeding the price and values outside int8', () => {
    expect(() => calculateSavingTotals(lines, 300_001n)).toThrow();
    expect(() =>
      calculateSavingTotals([{ ...lines[0], amountIrR: 9_223_372_036_854_775_807n }, lines[1]], 0n)
    ).toThrow();
  });
});
