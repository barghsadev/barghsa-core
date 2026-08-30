/**
 * Invoice calculation snapshot (T-04.1.02.08).
 *
 * JSON-serializable document stored on `invoices.invoice_calculation_snapshot`.
 * Captures every input, each VAT half-up rounding step, and the final
 * totals so an issued invoice can be reproduced later.
 *
 * `replayInvoiceCalculation` is the T-04.1.02.09 reproduction path:
 * it consumes only `snapshot.inputs` and re-runs the original math.
 *
 * Money is encoded as decimal-digit strings: JSON Number cannot carry
 * signed int8 IRR past `Number.MAX_SAFE_INTEGER`. Floating point is
 * forbidden — intermediates come from the same BigInt `roundHalfUpDiv`
 * primitive the calculation modules use.
 *
 * This module has no database or NestJS dependency.
 */

import {
  calculateManualInvoice,
  roundHalfUpDiv,
  type CalculatedManualLine,
  type ManualInvoiceCalculation,
  type ManualInvoiceLineInput,
} from './manual-invoice.calculation.js'
import {
  autoLineDescription,
  calculateAutoInvoice,
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

/**
 * Parse a snapshot IRR field back to bigint.
 *
 * Rejects JSON Numbers: PostgreSQL JSONB + `JSON.parse` would silently
 * lose precision on int8 amounts above `Number.MAX_SAFE_INTEGER` if the
 * snapshot stored money as numbers. A coerced number is a bug, not an
 * input to BigInt.
 */
export function parseIrrJson(value: unknown): bigint {
  if (typeof value === 'number') {
    throw new RangeError(
      'parseIrrJson: IRR arrived as a JSON Number — precision may be lost; expected a decimal-digit string',
    )
  }
  if (typeof value !== 'string' || !/^-?\d+$/.test(value)) {
    throw new RangeError(
      `parseIrrJson: expected a decimal-digit IRR string, got ${JSON.stringify(value)}`,
    )
  }
  return BigInt(value)
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

/** Per-line money produced by replaying snapshot inputs. */
export interface ReplayedInvoiceLine {
  lineTotal: bigint
  vatAmount: bigint
  discount: bigint
}

/**
 * Result of replaying `snapshot.inputs` through the same calculation
 * modules that issued the invoice. Totals are bigint IRR so the caller
 * can compare against both `snapshot.totals` (strings) and persisted
 * `invoices.total_amount` / `invoice_lines` (int8).
 */
export interface ReplayedInvoiceCalculation {
  source: 'manual' | 'auto'
  totalAmount: bigint
  subtotal: bigint
  totalVat: bigint
  totalDiscount: bigint
  lines: ReplayedInvoiceLine[]
}

function snapshotLineToManualInput(
  line: InvoiceCalculationSnapshotLineInput,
): ManualInvoiceLineInput {
  return {
    description: line.description,
    quantity: line.quantity,
    unitPrice: parseIrrJson(line.unitPrice),
    vatRate: line.vatRate,
    isTaxable: line.isTaxable,
  }
}

function snapshotLineToAutoInput(
  line: InvoiceCalculationSnapshotLineInput,
): AutoInvoiceLineInput {
  if (typeof line.productId !== 'string' || line.productId.length === 0) {
    throw new RangeError(
      'replayInvoiceCalculation: auto snapshot line is missing productId',
    )
  }
  if (typeof line.productType !== 'string' || line.productType.length === 0) {
    throw new RangeError(
      'replayInvoiceCalculation: auto snapshot line is missing productType',
    )
  }
  return {
    productId: line.productId,
    productType: line.productType,
    productTitle: line.productTitle ?? null,
    quantity: line.quantity,
    unitPrice: parseIrrJson(line.unitPrice),
    vatRate: line.vatRate,
    isTaxable: line.isTaxable,
  }
}

/** Decode snapshot totals (decimal-digit strings) to bigint IRR. */
export function parseSnapshotTotals(
  totals: InvoiceCalculationSnapshotTotals,
): {
  subtotal: bigint
  totalVat: bigint
  totalDiscount: bigint
  totalAmount: bigint
} {
  return {
    subtotal: parseIrrJson(totals.subtotal),
    totalVat: parseIrrJson(totals.totalVat),
    totalDiscount: parseIrrJson(totals.totalDiscount),
    totalAmount: parseIrrJson(totals.totalAmount),
  }
}

/**
 * Replay invoice calculation inputs stored on a snapshot and produce
 * the same bigint totals the original issue used.
 *
 * Only `snapshot.inputs` is consumed. Stored `steps` / `totals` are
 * ignored so this is a true reproduction, not a copy of cached results.
 *
 * @throws RangeError when the snapshot source is unknown, auto lines
 *   lack product identity, or any IRR field is not a digit string.
 */
export function replayInvoiceCalculation(
  snapshot: InvoiceCalculationSnapshot,
): ReplayedInvoiceCalculation {
  if (snapshot.source === 'manual') {
    const calc = calculateManualInvoice(
      snapshot.inputs.lines.map(snapshotLineToManualInput),
    )
    return {
      source: 'manual',
      totalAmount: calc.totalAmount,
      subtotal: calc.lines.reduce((sum, l) => sum + l.lineTotal, 0n),
      totalVat: calc.lines.reduce((sum, l) => sum + l.vatAmount, 0n),
      totalDiscount: 0n,
      lines: calc.lines.map((l) => ({
        lineTotal: l.lineTotal,
        vatAmount: l.vatAmount,
        discount: 0n,
      })),
    }
  }

  if (snapshot.source === 'auto') {
    const calc = calculateAutoInvoice(
      snapshot.inputs.lines.map(snapshotLineToAutoInput),
      parseIrrJson(snapshot.inputs.orderDiscount),
    )
    return {
      source: 'auto',
      totalAmount: calc.totalAmount,
      subtotal: calc.lines.reduce((sum, l) => sum + l.lineTotal, 0n),
      totalVat: calc.lines.reduce((sum, l) => sum + l.vatAmount, 0n),
      totalDiscount: calc.totalDiscount,
      lines: calc.lines.map((l) => ({
        lineTotal: l.lineTotal,
        vatAmount: l.vatAmount,
        discount: l.discount,
      })),
    }
  }

  throw new RangeError(
    `replayInvoiceCalculation: unknown snapshot source ${JSON.stringify(
      (snapshot as { source?: unknown }).source,
    )}`,
  )
}
