import { describe, expect, it } from 'vitest';
import type { GreenElectricityConfig } from '@barghsa/shared/finance';
import {
  calculateAveragePower,
  calculateDuration,
  calculateElectricityTotals,
  calculateLineTotal,
  checkGreenRule,
  electricitySubmissionSnapshot,
  validateOrderComposition,
  validateProductLimit,
  type ElectricityProductInput,
} from './electricity-calculation.js';

const period = { start: new Date('2026-09-23T00:00:00Z'), end: new Date('2026-09-23T01:00:00Z') };
const settings: GreenElectricityConfig = {
  simpleOrder: {
    mandatoryGreenEnabled: true,
    averagePowerThresholdKw: 100,
    mandatoryGreenSharePercent: 4,
  },
  advancedOrder: {
    mandatoryGreenEnabled: true,
    averagePowerThresholdKw: 0,
    mandatoryGreenSharePercent: 4,
  },
};
const product = (
  systemKey: ElectricityProductInput['systemKey'],
  overrides: Partial<ElectricityProductInput> = {}
): ElectricityProductInput => ({
  id: `${systemKey}-id`,
  systemKey,
  status: 'active',
  unitPriceIrR: 100n,
  minKwh: 0n,
  maxKwh: 0n,
  vatRateBasisPoints: 900,
  vatSource: 'category',
  ...overrides,
});

describe('exact electricity calculations', () => {
  it('keeps exact milliseconds for threshold decisions and multiplies large IRR values as bigint', () => {
    expect(calculateDuration(period.start, new Date('2026-09-23T01:30:00Z'))).toEqual({
      milliseconds: 5_400_000n,
      hours: '1.5',
    });
    expect(calculateAveragePower(3_000n, 10_800_000n)).toBe('1000');
    expect(calculateLineTotal(9_000_000_000n, 9_000_000_000n)).toBe(81_000_000_000_000_000_000n);
    expect(
      checkGreenRule({
        enabled: true,
        thresholdKw: 100,
        minGreenPercentage: 4,
        totalKwh: 100n,
        durationMs: 3_600_000n,
      })
    ).toEqual({ applies: false, requiredGreenKwh: 0n });
    expect(
      checkGreenRule({
        enabled: true,
        thresholdKw: 100,
        minGreenPercentage: 4,
        totalKwh: 101n,
        durationMs: 3_600_000n,
      })
    ).toEqual({ applies: true, requiredGreenKwh: 5n });
  });

  it('keeps the requested simple-order total unchanged and reports the exact green-limit conflict', () => {
    const composed = validateOrderComposition(
      { mode: 'simple', period, totalKwh: 101n },
      settings,
      [product('thermal'), product('green')]
    );
    expect(composed.ok).toBe(true);
    if (!composed.ok) return;
    expect(composed.totalKwh).toBe(101n);
    expect(composed.lines.map((line) => [line.systemKey, line.quantityKwh])).toEqual([
      ['thermal', 96n],
      ['green', 5n],
    ]);

    const blocked = validateOrderComposition({ mode: 'simple', period, totalKwh: 101n }, settings, [
      product('thermal'),
      product('green', { maxKwh: 4n }),
    ]);
    expect(blocked).toMatchObject({
      ok: false,
      errors: [{ code: 'PRODUCT_MAX_KWH', systemKey: 'green', requiredKwh: '5', limitKwh: '4' }],
    });
  });

  it('does not apply a minimum to zero or omitted products, but does apply it to positive lines', () => {
    expect(validateProductLimit(0n, product('green', { minKwh: 50n }))).toEqual([]);
    const belowThreshold = validateOrderComposition(
      { mode: 'simple', period, totalKwh: 50n },
      settings,
      [product('thermal'), product('green', { minKwh: 50n })]
    );
    expect(belowThreshold.ok).toBe(true);
    const belowMinimum = validateOrderComposition(
      { mode: 'simple', period, totalKwh: 101n },
      settings,
      [product('thermal'), product('green', { minKwh: 6n })]
    );
    expect(belowMinimum).toMatchObject({
      ok: false,
      errors: [{ code: 'PRODUCT_MIN_KWH', systemKey: 'green', requiredKwh: '6' }],
    });
  });

  it('rejects a composed line that cannot fit an invoice bigint amount', () => {
    expect(
      validateOrderComposition(
        { mode: 'simple', period, totalKwh: 2n },
        { ...settings, simpleOrder: { ...settings.simpleOrder, mandatoryGreenEnabled: false } },
        [product('thermal', { unitPriceIrR: 9_223_372_036_854_775_807n })]
      )
    ).toMatchObject({ ok: false, errors: [{ code: 'AMOUNT_OVERFLOW' }] });
  });

  it('derives advanced green from thermal and forbids customer green edits while enabled', () => {
    const products = [product('thermal'), product('green'), product('free_market')];
    const result = validateOrderComposition(
      { mode: 'advanced', period, quantities: { thermal: 100n, free_market: 50n } },
      settings,
      products
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.lines.map((line) => [line.systemKey, line.quantityKwh])).toEqual([
      ['thermal', 100n],
      ['green', 5n],
      ['free_market', 50n],
    ]);
    expect(
      validateOrderComposition(
        { mode: 'advanced', period, quantities: { thermal: 100n, green: 5n } },
        settings,
        products
      )
    ).toMatchObject({ ok: false, errors: [{ code: 'GREEN_NOT_EDITABLE' }] });
    expect(
      validateOrderComposition(
        { mode: 'advanced', period, quantities: { free_market: 100n } },
        settings,
        products
      )
    ).toMatchObject({ ok: false, errors: [{ code: 'GREEN_PERCENTAGE_UNSATISFIABLE' }] });
    const disabled = {
      ...settings,
      advancedOrder: { ...settings.advancedOrder, mandatoryGreenEnabled: false },
    };
    expect(
      validateOrderComposition(
        { mode: 'advanced', period, quantities: { green: 5n } },
        disabled,
        products
      ).ok
    ).toBe(true);
  });

  it('discounts net lines before half-up VAT and snapshots prices, rates and gift terms', () => {
    const composition = validateOrderComposition(
      { mode: 'simple', period, totalKwh: 101n },
      settings,
      [product('thermal'), product('green', { unitPriceIrR: 201n })]
    );
    expect(composition.ok).toBe(true);
    if (!composition.ok) return;
    const gift = { type: 'percentage' as const, basisPoints: 1_000, maxCapIrR: 1_000n };
    const totals = calculateElectricityTotals(composition.lines, gift);
    expect(totals.subtotalIrR).toBe(10_605n);
    expect(totals.discountIrR).toBe(1_000n);
    expect(totals.lines.reduce((sum, line) => sum + line.discountIrR, 0n)).toBe(1_000n);
    expect(
      totals.lines.every((line) => line.vatIrR === (line.netIrR * 900n * 2n + 10_000n) / 20_000n)
    ).toBe(true);
    const snapshot = electricitySubmissionSnapshot(composition, totals, gift, period, period.end);
    expect(snapshot).toMatchObject({
      totalKwh: '101',
      discountIrR: '1000',
      gift: { type: 'percentage', basisPoints: 1000, maxCapIrR: '1000' },
    });
    expect(snapshot.lines[0]).toMatchObject({
      productId: 'thermal-id',
      quantityKwh: '96',
      unitPriceIrR: '100',
      vatRateBasisPoints: 900,
    });
    expect(() => JSON.stringify(snapshot)).not.toThrow();
  });

  it('matches gift-code redemption floor rounding for percentage discounts', () => {
    const line = {
      productId: 'thermal-id',
      systemKey: 'thermal' as const,
      quantityKwh: 1n,
      unitPriceIrR: 50n,
      subtotalIrR: 50n,
      vatRateBasisPoints: 0,
      vatSource: 'fallback_zero' as const,
    };
    expect(
      calculateElectricityTotals([line], {
        type: 'percentage',
        basisPoints: 100,
        maxCapIrR: 100n,
      }).discountIrR
    ).toBe(0n);
  });
});
