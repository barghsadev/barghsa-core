/**
 * Invoice calculation snapshot (T-04.1.02.08).
 *
 * JSON-serializable document stored on `invoices.invoice_calculation_snapshot`.
 * Captures every input, each VAT half-up rounding step, and the final
 * totals so an issued invoice can be reproduced later (T-04.1.02.09).
 *
 * Money is encoded as decimal-digit strings: JSON Number cannot carry
 * signed int8 IRR past `Number.MAX_SAFE_INTEGER`. Floating point is
 * forbidden — intermediates come from the same BigInt `roundHalfUpDiv`
 * primitive the calculation modules use.
 *
 * This module has no database or NestJS dependency.
 */

import { roundHalfUpDiv } from './manual-invoice.calculation.js'
import type {
  CalculatedManualLine,
  ManualInvoiceCalculation,
  ManualInvoiceLineInput,
} from './manual-invoice.calculation.js'
import {
  autoLineDescription,
  type AutoInvoiceCalculation,
  type AutoInvoiceLineInput,
  type CalculatedAutoLine,
} from './auto-invoice.calculation.js'

/** Snapshot schema version. Bump when the document shape changes. */
export const INVOICE_CALCULATION_SNAPSHOT_VERSION = 1 as const

/** Canonical rounding rule recorded on every snapshot. */
export const INVOICE_ROUNDING_RULE = 'half-up-to-nearest-IRR' as const

/**
 * VAT rate is integer basis points (0..10000 = 0%..100%).
 * `roundHalfUpDiv(net × vatRate, VAT_BASIS_POINT_SCALE)` is the line VAT.
 */
export const VAT_BASIS_POINT_SCALE = 10_000 as const

/** Serialize a bigint IRR amount as a decimal-digit JSON string. */
export function irrJson(value: bigint): string {
  return value.toString()
}

/** One staff/system-entered line as stored for replay. */
export interface InvoiceCalculationSnapshotLineInput {
  description: string
  quantity: number
  /** Unit price in IRR (bigint as decimal-digit string). */
  unitPrice: string
  /** VAT rate in integer basis points: 900 = 9.00%. */
  vatRate: number
  isTaxable: boolean
  /** Present on auto invoices (product composition snapshot). */
  productId?: string
  productType?: string
  productTitle?: { fa?: string | null; en?: string | null } | null
}

/** All inputs needed to replay the invoice calculation. */
export interface InvoiceCalculationSnapshotInputs {
  lines: InvoiceCalculationSnapshotLineInput[]
  /**
   * Order-level gift-code discount in IRR (string). `"0"` for manual
   * invoices, which have no pre-VAT discount input.
   */
  orderDiscount: string
}

/**
 * One VAT half-up rounding step.
 *
 * `result = roundHalfUpDiv(numerator, denominator)` with
 * `numerator = netAmount × vatRate` and `denominator = 10000`.
 * `truncatedQuotient` / `remainder` reconstruct the exact rational so
 * a later reviewer can see *why* the half-up rule added (or did not add)
 * one IRR without re-running the math.
 */
export interface InvoiceVatRoundingStep {
  lineIndex: number
  operation: 'vat'
  /** Net taxable amount AFTER discount, BEFORE VAT. */
  netAmount: string
  vatRate: number
  isTaxable: boolean
  /** `netAmount × vatRate` (0 when the line is non-taxable). */
  numerator: string
  /** Always `"10000"` (VAT_BASIS_POINT_SCALE). */
  denominator: string
  /** Integer division `numerator / denominator` (truncated toward zero). */
  truncatedQuotient: string
  /** `numerator % denominator`. */
  remainder: string
  /**
   * True when `remainder * 2 >= denominator` — exact half or above, so
   * half-up added 1 IRR versus truncated division.
   */
  roundedUp: boolean
  /** Final half-up VAT in IRR. */
  result: string
}

/** Per-line intermediates: gross → discount → net → VAT rounding. */
export interface InvoiceLineCalculationStep {
  lineIndex: number
  /** quantity × unitPrice (pre-discount). */
  gross: string
  /** Discount allocated to this line (`"0"` for manual). */
  discount: string
  /** Remaining order-level discount after this line absorbed its share. */
  remainingDiscountAfter: string
  /** `gross − discount` — the pre-VAT line total. */
  lineTotal: string
  vat: InvoiceVatRoundingStep
}

/** Invoice-level money totals (all IRR strings). */
export interface InvoiceCalculationSnapshotTotals {
  /** Σ lineTotal (pre-VAT, post-discount). */
  subtotal: string
  /** Σ vatAmount. */
  totalVat: string
  /** Σ per-line discount. */
  totalDiscount: string
  /** subtotal + totalVat — the invoice total. */
  totalAmount: string
}

/** Canonical JSON document stored in `invoice_calculation_snapshot`. */
export interface InvoiceCalculationSnapshot {
  version: typeof INVOICE_CALCULATION_SNAPSHOT_VERSION
  source: 'manual' | 'auto'
  rounding: {
    rule: typeof INVOICE_ROUNDING_RULE
    vatScale: typeof VAT_BASIS_POINT_SCALE
  }
  inputs: InvoiceCalculationSnapshotInputs
  steps: InvoiceLineCalculationStep[]
  totals: InvoiceCalculationSnapshotTotals
}

/**
 * Record the VAT half-up rounding step for one line.
 *
 * Non-taxable lines skip the division and store a zero result, matching
 * the DB CHECK `is_taxable OR vat_amount = 0`.
 */
export function describeVatRounding(
  lineIndex: number,
  netAmount: bigint,
  vatRate: number,
  isTaxable: boolean,
): InvoiceVatRoundingStep {
  const denominator = BigInt(VAT_BASIS_POINT_SCALE)
  if (!isTaxable) {
    return {
      lineIndex,
      operation: 'vat',
      netAmount: irrJson(netAmount),
      vatRate,
      isTaxable: false,
      numerator: '0',
      denominator: irrJson(denominator),
      truncatedQuotient: '0',
      remainder: '0',
      roundedUp: false,
      result: '0',
    }
  }

  const numerator = netAmount * BigInt(vatRate)
  const truncatedQuotient = numerator / denominator
  const remainder = numerator % denominator
  const roundedUp = remainder * 2n >= denominator
  const result = roundHalfUpDiv(numerator, denominator)
  return {
    lineIndex,
    operation: 'vat',
    netAmount: irrJson(netAmount),
    vatRate,
    isTaxable: true,
    numerator: irrJson(numerator),
    denominator: irrJson(denominator),
    truncatedQuotient: irrJson(truncatedQuotient),
    remainder: irrJson(remainder),
    roundedUp,
    result: irrJson(result),
  }
}

function snapshotTotals(
  lines: Array<{ lineTotal: bigint; vatAmount: bigint; discount?: bigint }>,
  totalAmount: bigint,
): InvoiceCalculationSnapshotTotals {
  const subtotal = lines.reduce((sum, l) => sum + l.lineTotal, 0n)
  const totalVat = lines.reduce((sum, l) => sum + l.vatAmount, 0n)
  const totalDiscount = lines.reduce((sum, l) => sum + (l.discount ?? 0n), 0n)
  return {
    subtotal: irrJson(subtotal),
    totalVat: irrJson(totalVat),
    totalDiscount: irrJson(totalDiscount),
    totalAmount: irrJson(totalAmount),
  }
}

function roundingHeader() {
  return {
    rule: INVOICE_ROUNDING_RULE,
    vatScale: VAT_BASIS_POINT_SCALE,
  } as const
}

function manualLineStep(
  line: CalculatedManualLine,
  lineIndex: number,
): InvoiceLineCalculationStep {
  const gross = BigInt(line.quantity) * line.unitPrice
  return {
    lineIndex,
    gross: irrJson(gross),
    discount: '0',
    remainingDiscountAfter: '0',
    lineTotal: irrJson(line.lineTotal),
    vat: describeVatRounding(
      lineIndex,
      line.lineTotal,
      line.vatRate,
      line.isTaxable !== false,
    ),
  }
}

function autoLineStep(
  line: CalculatedAutoLine,
  lineIndex: number,
  remainingDiscountAfter: bigint,
): InvoiceLineCalculationStep {
  const gross = BigInt(line.quantity) * line.unitPrice
  return {
    lineIndex,
    gross: irrJson(gross),
    discount: irrJson(line.discount),
    remainingDiscountAfter: irrJson(remainingDiscountAfter),
    lineTotal: irrJson(line.lineTotal),
    vat: describeVatRounding(lineIndex, line.lineTotal, line.vatRate, line.isTaxable),
  }
}

/**
 * Build the calculation snapshot for a manual invoice.
 *
 * `inputs.lines` is the staff-entered command (replay source);
 * `steps` / `totals` are derived from the already-computed result so the
 * stored intermediates match what was persisted on the lines table.
 */
export function buildManualInvoiceCalculationSnapshot(
  inputs: ManualInvoiceLineInput[],
  calculation: ManualInvoiceCalculation,
): InvoiceCalculationSnapshot {
  return {
    version: INVOICE_CALCULATION_SNAPSHOT_VERSION,
    source: 'manual',
    rounding: roundingHeader(),
    inputs: {
      lines: inputs.map((l) => ({
        description: l.description,
        quantity: l.quantity,
        unitPrice: irrJson(l.unitPrice),
        vatRate: l.vatRate,
        isTaxable: l.isTaxable !== false,
      })),
      orderDiscount: '0',
    },
    steps: calculation.lines.map((line, index) => manualLineStep(line, index)),
    totals: snapshotTotals(calculation.lines, calculation.totalAmount),
  }
}

/**
 * Build the calculation snapshot for an auto-generated invoice.
 *
 * Discount allocation is recorded per line (`discount` +
 * `remainingDiscountAfter`) so a later replay can see how the order-level
 * gift discount was absorbed in composition order.
 */
export function buildAutoInvoiceCalculationSnapshot(
  inputs: AutoInvoiceLineInput[],
  orderDiscount: bigint,
  calculation: AutoInvoiceCalculation,
): InvoiceCalculationSnapshot {
  let remaining = orderDiscount
  const steps = calculation.lines.map((line, index) => {
    remaining -= line.discount
    return autoLineStep(line, index, remaining)
  })

  return {
    version: INVOICE_CALCULATION_SNAPSHOT_VERSION,
    source: 'auto',
    rounding: roundingHeader(),
    inputs: {
      lines: inputs.map((l) => ({
        description: autoLineDescription(l),
        quantity: l.quantity,
        unitPrice: irrJson(l.unitPrice),
        vatRate: l.vatRate,
        isTaxable: l.isTaxable !== false,
        productId: l.productId,
        productType: l.productType,
        productTitle: l.productTitle ?? null,
      })),
      orderDiscount: irrJson(orderDiscount),
    },
    steps,
    totals: snapshotTotals(
      calculation.lines.map((l) => ({
        lineTotal: l.lineTotal,
        vatAmount: l.vatAmount,
        discount: l.discount,
      })),
      calculation.totalAmount,
    ),
  }
}
