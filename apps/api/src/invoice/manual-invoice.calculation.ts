/**
 * Manual invoice calculation — pure, side-effect-free math (T-04.1.02.02).
 *
 * Given the staff-entered lines of a manual invoice, this module:
 *   1. validates each line against the S-04.1.02 / invoice_lines rules;
 *   2. computes `lineTotal` (quantity × unitPrice), `vatAmount`
 *      (half-up rounded to the nearest IRR on taxable lines) and the
 *      invoice `totalAmount` (Σ lineTotal + Σ vatAmount).
 *
 * Money rules (README §Invoices):
 *   - All amounts are integer IRR (`bigint`); floating point is forbidden.
 *   - VAT is calculated on the net taxable line amount using integer
 *     basis points (`vatRate` 0..10000 = 0%..100%) and rounded half-up
 *     to the nearest IRR at each final line.
 *   - Non-taxable lines always carry zero VAT (mirrors the DB CHECK
 *     `ck_invoice_lines_non_taxable_zero_vat`).
 *
 * This module has no database or NestJS dependency so it can be tested
 * table-driven and reused by any caller.
 */

/** One staff-entered line of a manual invoice. */
export interface ManualInvoiceLineInput {
  /** Human-readable line description (e.g. "مشاوره تخصصی برق — جلسه اول"). */
  description: string
  /** Quantity of the priced unit. Must be a positive integer. */
  quantity: number
  /** Unit price in IRR (bigint). Never negative. */
  unitPrice: bigint
  /** VAT rate in integer basis points: 900 = 9.00%. Must be 0..10000. */
  vatRate: number
  /** Whether the line participates in VAT. Defaults to true. */
  isTaxable?: boolean
}

/** A line after the calculation pass. */
export interface CalculatedManualLine extends ManualInvoiceLineInput {
  /** quantity × unitPrice — the pre-VAT subtotal. */
  lineTotal: bigint
  /** Half-up rounded VAT on the line; 0 for non-taxable lines. */
  vatAmount: bigint
}

/** Result of a full manual invoice calculation. */
export interface ManualInvoiceCalculation {
  /** Per-line results in the order the staff entered them. */
  lines: CalculatedManualLine[]
  /** Σ(lineTotal + vatAmount) — the invoice total in IRR. */
  totalAmount: bigint
}

/**
 * Round `numerator / denominator` half-up to the nearest whole unit.
 *
 * Half-up means a fractional part of exactly 0.5 rounds away from zero.
 * All financial inputs here are non-negative, so this equals
 * `ceil(numerator/denominator - 0.5)`, implemented with pure BigInt
 * arithmetic (no floats) and correct for ANY positive denominator —
 * the formula `(2n + d) / 2d` is exact for odd denominators too, where
 * `numerator + denominator/2` would floor and round 0.5 down. The common
 * financial case is `roundHalfUpDiv(lineTotal * vatRate, 10000)` — VAT at
 * integer basis points rounded to the nearest IRR.
 *
 * @throws RangeError when the denominator is not positive.
 */
export function roundHalfUpDiv(numerator: bigint, denominator: bigint): bigint {
  if (denominator <= 0n) {
    throw new RangeError('roundHalfUpDiv: denominator must be positive')
  }
  if (numerator < 0n) {
    throw new RangeError('roundHalfUpDiv: numerator must be non-negative')
  }
  // (2n + d) / 2d — exact half-up for any positive d (BigInt division
  // truncates toward zero, which equals floor for the non-negative
  // dividend 2n + d).
  return (numerator * 2n + denominator) / (denominator * 2n)
}

/** Validation error message for a manual invoice line. */
export const MANUAL_LINE_ERRORS = {
  NO_LINES: () => 'Manual invoice must contain at least one line',
  EMPTY_DESCRIPTION: () => 'Each line needs a non-empty description',
  BAD_QUANTITY: () => 'Line quantity must be a positive integer',
  NEGATIVE_UNIT_PRICE: () => 'Line unit price cannot be negative',
  BAD_VAT_RATE: () => 'Line VAT rate must be between 0 and 10000 basis points',
  ZERO_TOTAL: () => 'Manual invoice total must be positive',
} as const

/** Validate one input line, throwing a RangeError on the first violation. */
export function assertValidManualLine(line: ManualInvoiceLineInput): void {
  if (typeof line.description !== 'string' || line.description.trim() === '') {
    throw new RangeError(MANUAL_LINE_ERRORS.EMPTY_DESCRIPTION())
  }
  if (!Number.isInteger(line.quantity) || line.quantity <= 0) {
    throw new RangeError(MANUAL_LINE_ERRORS.BAD_QUANTITY())
  }
  if (typeof line.unitPrice !== 'bigint' || line.unitPrice < 0n) {
    throw new RangeError(MANUAL_LINE_ERRORS.NEGATIVE_UNIT_PRICE())
  }
  if (
    !Number.isInteger(line.vatRate) ||
    line.vatRate < 0 ||
    line.vatRate > 10_000
  ) {
    throw new RangeError(MANUAL_LINE_ERRORS.BAD_VAT_RATE())
  }
}

/**
 * Compute the money values of one line.
 *
 * `lineTotal` is quantity × unitPrice (manual lines have no per-line
 * discount input). `vatAmount` is `roundHalfUpDiv(lineTotal × vatRate,
 * 10000)` on taxable lines and 0 on non-taxable lines, matching the DB
 * CHECK `is_taxable OR vat_amount = 0`.
 */
export function calculateManualLine(line: ManualInvoiceLineInput): CalculatedManualLine {
  assertValidManualLine(line)
  const lineTotal = BigInt(line.quantity) * line.unitPrice
  const isTaxable = line.isTaxable !== false
  const vatAmount = isTaxable
    ? roundHalfUpDiv(lineTotal * BigInt(line.vatRate), 10_000n)
    : 0n
  return { ...line, isTaxable, lineTotal, vatAmount }
}

/**
 * Validate and calculate a full manual invoice.
 *
 * @throws RangeError with a MANUAL_LINE_ERRORS message on invalid input.
 */
export function calculateManualInvoice(
  lines: ManualInvoiceLineInput[],
): ManualInvoiceCalculation {
  if (!Array.isArray(lines) || lines.length === 0) {
    throw new RangeError(MANUAL_LINE_ERRORS.NO_LINES())
  }

  const calculated = lines.map((line) => calculateManualLine(line))
  const totalAmount = calculated.reduce(
    (sum, line) => sum + line.lineTotal + line.vatAmount,
    0n,
  )

  if (totalAmount <= 0n) {
    throw new RangeError(MANUAL_LINE_ERRORS.ZERO_TOTAL())
  }

  return { lines: calculated, totalAmount }
}