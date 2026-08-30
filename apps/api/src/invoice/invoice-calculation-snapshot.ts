/**
 * Invoice calculation snapshot builder (T-04.1.02.08).
 *
 * Serializes a completed invoice calculation into the JSON-safe
 * `InvoiceCalculationSnapshot` stored on
 * `invoices.invoice_calculation_snapshot`. IRR amounts are decimal
 * strings; VAT rounding intermediates (numerator, truncated quotient,
 * remainder, exact-half flag, rounded result) are recorded so T-04.1.02.09
 * can replay `inputs` and assert the same `totals`.
 *
 * This module has no database or NestJS dependency. It reuses
 * `roundHalfUpDiv` so the recorded `rounded` value is produced by the
 * same primitive the live calculator used.
 */

import type {
  InvoiceCalculationSnapshot,
  InvoiceVatRoundingStep,
} from '@barghsa/db'
import { roundHalfUpDiv } from './manual-invoice.calculation.js'
import type {
  CalculatedManualLine,
  ManualInvoiceCalculation,
} from './manual-invoice.calculation.js'
import type {
  AutoInvoiceCalculation,
  CalculatedAutoLine,
} from './auto-invoice.calculation.js'

/** Must match `INVOICE_CALCULATION_SNAPSHOT_VERSION` in @barghsa/db. */
const SNAPSHOT_VERSION = 1 as const
/** Must match `INVOICE_ROUNDING_RULE` in @barghsa/db. */
const ROUNDING_RULE = 'half-up-to-nearest-IRR' as const
/** Must match `VAT_BASIS_POINT_SCALE` in @barghsa/db. */
const VAT_SCALE = 10_000 as const

/** Decimal-string encoding of a bigint IRR amount (JSON-safe). */
export function irrString(value: bigint): string {
  return value.toString()
}

/**
 * Record the VAT half-up rounding step for one line.
 *
 * Non-taxable lines always carry zero VAT (matching
 * `ck_invoice_lines_non_taxable_zero_vat`); the step still records the
 * rate so replay knows the line was skipped, not rounded to zero.
 */
export function recordVatRoundingStep(
  lineTotal: bigint,
  vatRate: number,
  isTaxable: boolean,
): InvoiceVatRoundingStep {
  const denominator = BigInt(VAT_SCALE)
  if (!isTaxable) {
    return {
      isTaxable: false,
      rateBps: vatRate,
      numerator: '0',
      denominator: irrString(denominator),
      truncated: '0',
      remainder: '0',
      exactHalf: false,
      rounded: '0',
    }
  }
  const numerator = lineTotal * BigInt(vatRate)
  const truncated = numerator / denominator
  const remainder = numerator % denominator
  const rounded = roundHalfUpDiv(numerator, denominator)
  return {
    isTaxable: true,
    rateBps: vatRate,
    numerator: irrString(numerator),
    denominator: irrString(denominator),
    truncated: irrString(truncated),
    remainder: irrString(remainder),
    exactHalf: remainder * 2n === denominator,
    rounded: irrString(rounded),
  }
}

function totalsFromLines(
  lines: ReadonlyArray<{ lineTotal: bigint; vatAmount: bigint; discount?: bigint }>,
): InvoiceCalculationSnapshot['totals'] {
  let subtotal = 0n
  let totalVat = 0n
  let totalDiscount = 0n
  for (const line of lines) {
    subtotal += line.lineTotal
    totalVat += line.vatAmount
    totalDiscount += line.discount ?? 0n
  }
  return {
    subtotal: irrString(subtotal),
    totalVat: irrString(totalVat),
    totalDiscount: irrString(totalDiscount),
    totalAmount: irrString(subtotal + totalVat),
  }
}

/**
 * Build the calculation snapshot for a completed manual invoice.
 *
 * Manual invoices have no order-level discount; every line's
 * `remainingDiscountBefore` / `After` is `"0"`.
 */
export function buildManualCalculationSnapshot(
  calculation: ManualInvoiceCalculation,
): InvoiceCalculationSnapshot {
  const steps = calculation.lines.map((line: CalculatedManualLine, lineIndex) => {
    const gross = BigInt(line.quantity) * line.unitPrice
    const vat = recordVatRoundingStep(line.lineTotal, line.vatRate, line.isTaxable !== false)
    if (vat.rounded !== irrString(line.vatAmount)) {
      throw new Error(
        `VAT snapshot rounded ${vat.rounded} !== calculated ${line.vatAmount}`,
      )
    }
    return {
      lineIndex,
      description: line.description,
      quantity: line.quantity,
      unitPrice: irrString(line.unitPrice),
      gross: irrString(gross),
      discount: '0',
      remainingDiscountBefore: '0',
      remainingDiscountAfter: '0',
      lineTotal: irrString(line.lineTotal),
      vat,
    }
  })

  return {
    version: SNAPSHOT_VERSION,
    rounding: ROUNDING_RULE,
    vatScale: VAT_SCALE,
    source: 'manual',
    inputs: {
      lines: calculation.lines.map((line) => ({
        description: line.description,
        quantity: line.quantity,
        unitPrice: irrString(line.unitPrice),
        vatRate: line.vatRate,
        isTaxable: line.isTaxable !== false,
      })),
      orderDiscount: '0',
    },
    steps,
    totals: totalsFromLines(calculation.lines),
  }
}

/**
 * Build the calculation snapshot for a completed auto invoice.
 *
 * Discount allocation is reconstructed in composition order (each line
 * absorbs up to its gross) so the snapshot records the same remaining
 * discount walk the calculator used.
 */
export function buildAutoCalculationSnapshot(
  calculation: AutoInvoiceCalculation,
  orderDiscount = 0n,
): InvoiceCalculationSnapshot {
  let remaining = orderDiscount
  const steps = calculation.lines.map((line: CalculatedAutoLine, lineIndex) => {
    const gross = BigInt(line.quantity) * line.unitPrice
    const remainingBefore = remaining
    remaining -= line.discount
    const vat = recordVatRoundingStep(line.lineTotal, line.vatRate, line.isTaxable)
    if (vat.rounded !== irrString(line.vatAmount)) {
      throw new Error(
        `VAT snapshot rounded ${vat.rounded} !== calculated ${line.vatAmount}`,
      )
    }
    return {
      lineIndex,
      description: line.description,
      quantity: line.quantity,
      unitPrice: irrString(line.unitPrice),
      gross: irrString(gross),
      discount: irrString(line.discount),
      remainingDiscountBefore: irrString(remainingBefore),
      remainingDiscountAfter: irrString(remaining),
      lineTotal: irrString(line.lineTotal),
      vat,
    }
  })

  return {
    version: SNAPSHOT_VERSION,
    rounding: ROUNDING_RULE,
    vatScale: VAT_SCALE,
    source: 'auto',
    inputs: {
      lines: calculation.lines.map((line) => ({
        description: line.description,
        quantity: line.quantity,
        unitPrice: irrString(line.unitPrice),
        vatRate: line.vatRate,
        isTaxable: line.isTaxable,
        productId: line.productId,
        productType: line.productType,
      })),
      orderDiscount: irrString(orderDiscount),
    },
    steps,
    totals: totalsFromLines(calculation.lines),
  }
}
