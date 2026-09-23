import { describe, expect, it } from 'vitest';
import {
  quoteIncreaseAdjustment,
  validateIncreaseQuantity,
} from './electricity-increase.service.js';

describe('electricity quantity increase limit', () => {
  it('is disabled at zero and rejects unchanged or lower quantities', () => {
    expect(validateIncreaseQuantity(100n, 101n, 0)).toBe(false);
    expect(validateIncreaseQuantity(100n, 100n, 20)).toBe(false);
    expect(validateIncreaseQuantity(100n, 99n, 20)).toBe(false);
  });

  it('accepts the exact cap and rejects one kWh above it', () => {
    expect(validateIncreaseQuantity(100n, 120n, 20)).toBe(true);
    expect(validateIncreaseQuantity(100n, 121n, 20)).toBe(false);
  });

  it('calculates without losing precision for quantities above Number.MAX_SAFE_INTEGER', () => {
    const original = 9_007_199_254_740_993n;
    const cap = original + original / 10n;
    expect(validateIncreaseQuantity(original, cap, 10)).toBe(true);
    expect(validateIncreaseQuantity(original, cap + 1n, 10)).toBe(false);
  });

  it('rejects quantities that cannot fit in the database bigint column', () => {
    expect(
      validateIncreaseQuantity(9_000_000_000_000_000_000n, 9_999_999_999_999_999_999n, 20)
    ).toBe(false);
  });
});

describe('electricity increase adjustment quote', () => {
  const periodStart = new Date('2026-10-01T00:00:00Z');
  const periodEnd = new Date('2026-10-11T00:00:00Z');

  it('prices only the additional future share of the original paid invoice', () => {
    const quote = quoteIncreaseAdjustment({
      originalInvoiceIrR: 1_000_000n,
      originalKwh: 10n,
      requestedKwh: 12n,
      periodStart,
      periodEnd,
      effectiveFrom: new Date('2026-10-06T00:00:00Z'),
      now: new Date('2026-10-02T00:00:00Z'),
    });
    expect(quote.amount).toBe(100_000n);
    expect(quote.eligibleStart.toISOString()).toBe('2026-10-06T00:00:00.000Z');
  });

  it('never prices an elapsed delivery period', () => {
    expect(() =>
      quoteIncreaseAdjustment({
        originalInvoiceIrR: 1_000_000n,
        originalKwh: 10n,
        requestedKwh: 12n,
        periodStart,
        periodEnd,
        effectiveFrom: periodStart,
        now: periodEnd,
      })
    ).toThrow('No eligible future delivery remains');
  });
});
