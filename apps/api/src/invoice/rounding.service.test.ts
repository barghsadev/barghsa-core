/**
 * Table-driven tests for the rounding service (T-04.1.02.07).
 *
 * Financial examples from product requirements (README §Invoices,
 * S-04.1.02): percentage calculations carry full integer precision
 * internally and are rounded HALF-UP to the nearest IRR at each final
 * invoice line. The VAT basis-point scale (`precision = 4`) is the
 * dominant real-world use: `roundHalfUp(lineTotal × vatRateBps, 4)`.
 */

import { describe, it, expect, beforeEach } from 'vitest'
import {
  RoundingService,
  ROUNDING_ERRORS,
  MAX_ROUNDING_PRECISION,
} from './rounding.service.js'

describe('RoundingService.roundHalfUp (T-04.1.02.07)', () => {
  let service: RoundingService

  beforeEach(() => {
    service = new RoundingService()
  })

  it.each([
    // [value (scaled by 10^precision), precision, expected whole IRR]
    // identity: precision 0 means the value is already whole IRR
    [0n, 0, 0n],
    [1n, 0, 1n],
    [12_345n, 0, 12_345n],
    // precision 1 — sub-IRR tenths (rare; kept for the API contract)
    [5n, 1, 1n], // 0.5 → 1 (exact half up)
    [4n, 1, 0n], // 0.4 → 0
    [6n, 1, 1n], // 0.6 → 1
    [10n, 1, 1n], // 1.0 → 1 (already integral)
    // precision 2 — sub-IRR hundredths
    [150n, 2, 2n], // 1.50 → 2 (exact half up)
    [149n, 2, 1n], // 1.49 → 1
    [151n, 2, 2n], // 1.51 → 2
    // precision 4 — VAT basis points (rate × 10_000)
    // 9% VAT (900 bps) on 1,000,000 IRR net = 90,000.0000 → 90,000
    [1_000_000n * 900n, 4, 90_000n],
    // 9% on 750,000 = 67,500 exactly
    [750_000n * 900n, 4, 67_500n],
    // 10% (1000 bps) on 55,055 → 5,505.5 → 5,506 (exact half up)
    [55_055n * 1000n, 4, 5_506n],
    // 10% on 55,054 → 5,505.4 → 5,505
    [55_054n * 1000n, 4, 5_505n],
    // 10% on 55,056 → 5,505.6 → 5,506
    [55_056n * 1000n, 4, 5_506n],
    // 1 bp of 1,000,000 = 100.0000 → 100
    [1_000_000n * 1n, 4, 100n],
    // sub-IRR fractions at 1 bp: 0.01 → 0
    [100n * 1n, 4, 0n],
    // 0.05 → 0
    [500n * 1n, 4, 0n],
    // 0.5 → 1 (exact half up)
    [5_000n * 1n, 4, 1n],
    // 0.9 → 1
    [9_000n * 1n, 4, 1n],
    // large amounts stay exact at 9% VAT
    [9_223_372_036_854_775_807n, 4, 922_337_203_685_478n], // int8 max × 1 = 9.22…e14.5807 → half-up .5807 → +1
  ])('rounds half-up to the nearest IRR: roundHalfUp(%n, %n) → %n', (value, precision, expected) => {
    expect(service.roundHalfUp(value, precision)).toBe(expected)
  })

  it('rounds the canonical README example: 10% VAT on 55,055 IRR → 5,506 IRR', () => {
    // 55,055 × 0.10 = 5,505.5 → half-up → 5,506
    expect(service.roundHalfUp(55_055n * 1000n, 4)).toBe(5_506n)
    // 55,055 × 0.09 = 4,954.95 → half-up → 4,955
    expect(service.roundHalfUp(55_055n * 900n, 4)).toBe(4_955n)
  })

  it('rounds exact halves up, never toward even (banker’s rounding forbidden)', () => {
    // 2.5 → 3 (not 2)
    expect(service.roundHalfUp(250n, 2)).toBe(3n)
    // 3.5 → 4 (not 4 via even rule — sanity anchor)
    expect(service.roundHalfUp(350n, 2)).toBe(4n)
    // 1.5 → 2
    expect(service.roundHalfUp(15n, 1)).toBe(2n)
  })

  it('is consistent with the VAT service examples at basis-point precision', () => {
    // vatAmount(1_000_000n, 900) = 90,000 ⟺ roundHalfUp(1_000_000n*900n, 4)
    expect(service.roundHalfUp(1_000_000n * 900n, 4)).toBe(90_000n)
    expect(service.roundHalfUp(55_055n * 1000n, 4)).toBe(5_506n)
    expect(service.roundHalfUp(55_054n * 1000n, 4)).toBe(5_505n)
  })

  it('rejects negative values (money is never negative)', () => {
    expect(() => service.roundHalfUp(-1n, 4)).toThrow(RangeError)
    expect(() => service.roundHalfUp(-1n, 4)).toThrow(ROUNDING_ERRORS.NEGATIVE_VALUE())
  })

  it('rejects non-bigint values', () => {
    // Runtime guard for callers bypassing TypeScript (e.g. JS/CJS bridges).
    expect(() => service.roundHalfUp(1 as unknown as bigint, 4)).toThrow(RangeError)
    expect(() => service.roundHalfUp(1 as unknown as bigint, 4)).toThrow(
      ROUNDING_ERRORS.NEGATIVE_VALUE(),
    )
  })

  it.each([
    [-1, 'negative precision'],
    [1.5, 'fractional precision'],
    [Number.NaN, 'NaN precision'],
    [Number.POSITIVE_INFINITY, 'infinite precision'],
    [MAX_ROUNDING_PRECISION + 1, 'precision above the int8-scaled bound'],
  ])('rejects invalid precision: %s (%s)', (precision) => {
    expect(() => service.roundHalfUp(100n, precision)).toThrow(RangeError)
    expect(() => service.roundHalfUp(100n, precision)).toThrow(ROUNDING_ERRORS.BAD_PRECISION())
  })

  it('accepts the maximum precision bound', () => {
    // 1 × 10^18 scaled by 10^18 = 1.000000000000000000 → 1
    expect(service.roundHalfUp(1n * 10n ** BigInt(MAX_ROUNDING_PRECISION), MAX_ROUNDING_PRECISION)).toBe(1n)
    // 1,500… × 10^18 → 1.5 → 2
    expect(service.roundHalfUp(15n * 10n ** BigInt(MAX_ROUNDING_PRECISION - 1), MAX_ROUNDING_PRECISION)).toBe(2n)
  })

  it('rounds zero to zero at any precision', () => {
    expect(service.roundHalfUp(0n, 0)).toBe(0n)
    expect(service.roundHalfUp(0n, 4)).toBe(0n)
    expect(service.roundHalfUp(0n, MAX_ROUNDING_PRECISION)).toBe(0n)
  })
})