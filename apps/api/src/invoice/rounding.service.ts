/**
 * Rounding service (T-04.1.02.07).
 *
 * First-class, injectable service encapsulating the money-rounding rule of
 * S-04.1.02 / README §Invoices: percentage calculations carry full integer
 * precision internally and are rounded HALF-UP to the nearest IRR at each
 * final invoice line, with floating point forbidden.
 *
 * API — `roundHalfUp(value: bigint, precision: number)`:
 *
 *   `value` is an amount expressed in units of `1/10^precision` IRR (i.e.
 *   scaled by `10^precision`), and the result is the nearest whole IRR,
 *   rounding exact halves away from zero:
 *
 *     roundHalfUp(value, precision) = roundHalfUpDiv(value, 10^precision)
 *
 *   - `precision = 0` → identity (the value is already whole IRR).
 *   - `precision = 4` → the VAT basis-point scale: a line's VAT is
 *     `roundHalfUp(lineTotal × vatRateBps, 4)`, e.g. 10% on 55,055 IRR
 *     → 5,505.5 → 5,506 IRR.
 *
 * The service is a thin validated wrapper over the pure BigInt primitive
 * `roundHalfUpDiv` (manual-invoice.calculation.ts) so there is exactly one
 * rounding implementation in the codebase.
 *
 * @throws RangeError when `value` is negative, not a bigint, or
 *   `precision` is not an integer in `[0, MAX_ROUNDING_PRECISION]`.
 */

import { Injectable } from '@nestjs/common'
import { roundHalfUpDiv } from './manual-invoice.calculation.js'

/**
 * Largest supported `precision` exponent.
 *
 * 18 matches the schema's signed int8 IRR magnitude
 * (9,223,372,036,854,775,807): any realistic amount scaled by 10^18 stays
 * representable, and a bounded exponent keeps input validation cheap.
 */
export const MAX_ROUNDING_PRECISION = 18

/** Error messages for the rounding surface. */
export const ROUNDING_ERRORS = {
  NOT_BIGINT: () => 'roundHalfUp: value must be a bigint',
  NEGATIVE_VALUE: () => 'roundHalfUp: value must be non-negative (money is never negative)',
  BAD_PRECISION: () =>
    `roundHalfUp: precision must be an integer between 0 and ${MAX_ROUNDING_PRECISION}`,
} as const

@Injectable()
export class RoundingService {
  /**
   * Round a scaled integer IRR amount half-up to the nearest whole IRR.
   *
   * @param value Amount scaled by `10^precision` (BigInt, non-negative).
   * @param precision Number of fractional decimal digits carried by
   *   `value` (0 = whole IRR, 4 = basis-point VAT scale).
   * @returns The nearest whole IRR, exact halves rounding away from zero.
   */
  roundHalfUp(value: bigint, precision: number): bigint {
    if (typeof value !== 'bigint') {
      throw new TypeError(ROUNDING_ERRORS.NOT_BIGINT())
    }
    if (value < 0n) {
      throw new RangeError(ROUNDING_ERRORS.NEGATIVE_VALUE())
    }
    if (
      !Number.isInteger(precision) ||
      precision < 0 ||
      precision > MAX_ROUNDING_PRECISION
    ) {
      throw new RangeError(ROUNDING_ERRORS.BAD_PRECISION())
    }
    if (precision === 0) return value
    return roundHalfUpDiv(value, 10n ** BigInt(precision))
  }
}
