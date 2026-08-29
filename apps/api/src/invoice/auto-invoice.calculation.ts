/**
 * Auto invoice calculation — pure, side-effect-free math (T-04.1.02.03).
 *
 * Auto-generated invoices are produced by AutoInvoiceService when an
 * order is created (S-04.1.02 "Auto-generated invoices"): one initial
 * invoice for the complete amount, linked to the originating order,
 * with a full snapshot of prices, VAT rate, product composition and
 * gift-code discount AT CREATION TIME.
 *
 * Money rules (README §Invoices, S-04.1.02):
 *   - All amounts are integer IRR (`bigint`); floating point is forbidden.
 *   - VAT is calculated on the NET TAXABLE line amount (after any
 *     discount), using integer basis points (`vatRate` 0..10000 =
 *     0%..100%) and rounded half-up to the nearest IRR per final line.
 *   - Discounts are applied BEFORE VAT (T-03.02.03.06): the gift-code
 *     discount is subtracted from the line subtotal, and VAT is then
 *     computed on the reduced amount.
 *   - Non-taxable lines always carry zero VAT (mirrors the DB CHECK
 *     `ck_invoice_lines_non_taxable_zero_vat`).
 *
 * The order model today is single-product (order → one product), so the
 * auto invoice carries one line; the calculation is written generically
 * over a line list so richer compositions (electricity bundles, saving
 * plan + hardware) reuse the same rules when E-03 lands them.
 *
 * This module has no database or NestJS dependency; it is table-driven
 * testable and shared by the service and any worker.
 */

import { roundHalfUpDiv } from './manual-invoice.calculation.js'

/** Product composition input for one auto-invoice line. */
export interface AutoInvoiceLineInput {
  /** FK products.id — the composed product. */
  productId: string
  /** FK products.type — snapshot source for charge category fallback. */
  productType: string
  /** Localized product title (`{fa,en}`) — snapshotted into items/metadata. */
  productTitle: { fa?: string | null; en?: string | null } | null
  /** Quantity of the priced unit. Must be a positive integer. */
  quantity: number
  /** Unit price in IRR (bigint) — snapshot at creation time. Never negative. */
  unitPrice: bigint
  /** VAT rate in integer basis points: 900 = 9.00%. Must be 0..10000. */
  vatRate: number
  /** Whether the line participates in VAT. Defaults to true. */
  isTaxable?: boolean
}

/** One line after the calculation pass. */
export interface CalculatedAutoLine {
  /** Human-readable line description (localized product title). */
  description: string
  /** FK products.id — the composed product. */
  productId: string
  /** FK products.type — snapshot for composition display. */
  productType: string
  /** Localized product title snapshot. */
  productTitle: { fa?: string | null; en?: string | null } | null
  /** Quantity of the priced unit. */
  quantity: number
  /** Unit price snapshot in IRR. */
  unitPrice: bigint
  /**
   * Line subtotal in IRR — quantity × unitPrice AFTER the allocated
   * discount, BEFORE VAT. Matches the invoice_lines semantics: a line's
   * `line_total` is the net taxable subtotal (discounts applied first).
   */
  lineTotal: bigint
  /** Net of the pre-VAT discount on this line (0 when no discount). */
  discount: bigint
  /** Half-up rounded VAT on the net taxable amount; 0 for non-taxable. */
  vatAmount: bigint
  /** VAT rate in basis points as applied. */
  vatRate: number
  /** Whether the line participates in VAT. */
  isTaxable: boolean
}

/** Result of the full auto-invoice calculation. */
export interface AutoInvoiceCalculation {
  /** Per-line results in composition order. */
  lines: CalculatedAutoLine[]
  /** Σ(lineTotal + vatAmount) — the invoice total in IRR. */
  totalAmount: bigint
  /** Total pre-VAT discount applied (sum of per-line discounts). */
  totalDiscount: bigint
}

/** Calculation error messages (guarded in the service to 4xx). */
export const AUTO_INVOICE_ERRORS = {
  NO_LINES: () => 'Cannot auto-generate an invoice without any lines',
  BAD_QUANTITY: () => 'Line quantity must be a positive integer',
  NEGATIVE_UNIT_PRICE: () => 'Line unit price cannot be negative',
  BAD_VAT_RATE: () => 'Line VAT rate must be between 0 and 10000 basis points',
  NEGATIVE_DISCOUNT: () => 'Gift discount cannot be negative',
  DISCOUNT_EXCEEDS_LINE: (discount: bigint, subtotal: bigint) =>
    `Gift discount ${discount} IRR exceeds the line subtotal ${subtotal} IRR`,
  DISCOUNT_EXCEEDS_INVOICE: (discount: bigint, gross: bigint) =>
    `Gift discount ${discount} IRR exceeds the invoice subtotal ${gross} IRR`,
  NEGATIVE_TOTAL: () => 'Auto invoice total cannot be negative',
} as const

/** Validate one input line, throwing a RangeError on the first violation. */
export function assertValidAutoLine(line: AutoInvoiceLineInput): void {
  if (!Number.isInteger(line.quantity) || line.quantity <= 0) {
    throw new RangeError(AUTO_INVOICE_ERRORS.BAD_QUANTITY())
  }
  if (typeof line.unitPrice !== 'bigint' || line.unitPrice < 0n) {
    throw new RangeError(AUTO_INVOICE_ERRORS.NEGATIVE_UNIT_PRICE())
  }
  if (
    !Number.isInteger(line.vatRate) ||
    line.vatRate < 0 ||
    line.vatRate > 10_000
  ) {
    throw new RangeError(AUTO_INVOICE_ERRORS.BAD_VAT_RATE())
  }
}

/** Build the human-readable line description from the product title. */
export function autoLineDescription(line: AutoInvoiceLineInput): string {
  const title = line.productTitle
  const fa = title?.fa ?? null
  const en = title?.en ?? null
  const candidate = fa && fa.trim() !== '' ? fa : en && en.trim() !== '' ? en : null
  return candidate ?? line.productType
}

/**
 * Compute the money values of one line, applying a pre-VAT discount.
 *
 * `lineTotal` = quantity × unitPrice − discount (never negative);
 * `vatAmount` = roundHalfUpDiv(lineTotal × vatRate, 10000) on taxable
 * lines and 0 on non-taxable lines, matching the DB CHECK
 * `is_taxable OR vat_amount = 0`.
 *
 * @throws RangeError when the discount exceeds the pre-discount subtotal
 *   (the line total would go negative).
 */
export function calculateAutoLine(
  line: AutoInvoiceLineInput,
  discount = 0n,
): CalculatedAutoLine {
  assertValidAutoLine(line)
  if (discount < 0n) {
    throw new RangeError(AUTO_INVOICE_ERRORS.NEGATIVE_DISCOUNT())
  }
  const gross = BigInt(line.quantity) * line.unitPrice
  if (discount > gross) {
    throw new RangeError(AUTO_INVOICE_ERRORS.DISCOUNT_EXCEEDS_LINE(discount, gross))
  }
  // A zero line (discount == gross) is legitimate: a 100%-coverage gift
  // code (fixed_irr caps at min(value, orderAmount)) fully pays the line.
  const isTaxable = line.isTaxable !== false
  const lineTotal = gross - discount
  const vatAmount = isTaxable
    ? roundHalfUpDiv(lineTotal * BigInt(line.vatRate), 10_000n)
    : 0n
  return {
    description: autoLineDescription(line),
    productId: line.productId,
    productType: line.productType,
    productTitle: line.productTitle ?? null,
    quantity: line.quantity,
    unitPrice: line.unitPrice,
    lineTotal,
    discount,
    vatAmount,
    vatRate: line.vatRate,
    isTaxable,
  }
}

/**
 * Validate and calculate a full auto invoice from composed lines.
 *
 * The order-level gift-code discount is allocated across the lines in
 * composition order, each line absorbing at most its pre-discount gross
 * (`quantity × unitPrice`). Any discount left after the last line throws —
 * a partially-applicable gift discount can never be silently dropped.
 * Discounts reduce the line subtotal BEFORE VAT (T-03.02.03.06): taxable
 * lines compute VAT on the net amount; non-taxable lines absorb discount
 * with zero VAT.
 *
 * @throws RangeError with an AUTO_INVOICE_ERRORS message on invalid input.
 */
export function calculateAutoInvoice(
  lines: AutoInvoiceLineInput[],
  orderDiscount = 0n,
): AutoInvoiceCalculation {
  if (!Array.isArray(lines) || lines.length === 0) {
    throw new RangeError(AUTO_INVOICE_ERRORS.NO_LINES())
  }
  if (orderDiscount < 0n) {
    throw new RangeError(AUTO_INVOICE_ERRORS.NEGATIVE_DISCOUNT())
  }

  const totalGross = lines.reduce(
    (sum, l) => sum + BigInt(l.quantity) * l.unitPrice,
    0n,
  )
  let remaining = orderDiscount
  const calculated = lines.map((line) => {
    // Absorb as much of the remaining discount as this line can carry.
    const gross = BigInt(line.quantity) * line.unitPrice
    const discount = remaining > 0n ? (remaining < gross ? remaining : gross) : 0n
    remaining -= discount
    const result = calculateAutoLine(line, discount)
    return result
  })

  if (remaining > 0n) {
    throw new RangeError(
      AUTO_INVOICE_ERRORS.DISCOUNT_EXCEEDS_INVOICE(orderDiscount, totalGross),
    )
  }

  const totalAmount = calculated.reduce(
    (sum, line) => sum + line.lineTotal + line.vatAmount,
    0n,
  )
  const totalDiscount = calculated.reduce((sum, line) => sum + line.discount, 0n)

  if (totalAmount < 0n) {
    throw new RangeError(AUTO_INVOICE_ERRORS.NEGATIVE_TOTAL())
  }

  return { lines: calculated, totalAmount, totalDiscount }
}