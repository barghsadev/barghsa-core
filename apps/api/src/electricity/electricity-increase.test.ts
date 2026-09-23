import { describe, expect, it } from 'vitest';
import { validateIncreaseQuantity } from './electricity-increase.service.js';

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
