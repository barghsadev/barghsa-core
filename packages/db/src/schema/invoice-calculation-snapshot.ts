/**
 * Invoice calculation snapshot (T-04.1.02.08).
 *
 * JSON-serializable payload stored on `invoices.invoice_calculation_snapshot`.
 * README §Invoices: "The invoice stores inputs, rounding results, and totals
 * so they can be reproduced later." All IRR amounts are decimal **strings**
 * (never JS numbers / bigint) so JSON round-trips without precision loss.
 *
 * `version` is a document schema version, not an invoice version. Bump it
 * only when the JSON shape changes; T-04.1.02.09 replays `inputs` through
 * the same calculation and asserts `totals`.
 */

/** Document schema version of the snapshot JSON. */
export const INVOICE_CALCULATION_SNAPSHOT_VERSION = 1 as const

/** Canonical rounding rule snapshotted on every invoice. */
export const INVOICE_ROUNDING_RULE = 'half-up-to-nearest-IRR' as const

/** VAT is integer basis points; the rounding denominator is always 10_000. */
export const VAT_BASIS_POINT_SCALE = 10_000 as const

/** Invoice origin that produced this snapshot. */
export type InvoiceCalculationSource = 'manual' | 'auto'

/**
 * One VAT rounding step: `roundHalfUpDiv(lineTotal × vatRate, 10_000)`.
 *
 * `numerator` / `denominator` are the exact BigInt operands; `truncated`
 * is integer division toward zero; `remainder` is `numerator % denominator`;
 * `exactHalf` is true iff `remainder * 2 === denominator` (the half-up
 * boundary); `rounded` is the stored IRR VAT amount.
 */
export interface InvoiceVatRoundingStep {
  /** Whether this line participates in VAT. */
  isTaxable: boolean
  /** VAT rate in basis points as applied (0..10000). */
  rateBps: number
  /** `lineTotal × vatRate` — unrounded numerator (decimal string). */
  numerator: string
  /** Always `"10000"` for basis-point VAT. */
  denominator: string
  /** `numerator / denominator` truncated toward zero. */
  truncated: string
  /** `numerator % denominator`. */
  remainder: string
  /** True when the fractional part is exactly 0.5. */
  exactHalf: boolean
  /** Half-up rounded VAT in IRR; `"0"` when the line is not taxable. */
  rounded: string
}

/** One staff/product line as it entered the calculator. */
export interface InvoiceCalculationLineInput {
  /** Human-readable line description. */
  description: string
  /** Quantity of the priced unit. */
  quantity: number
  /** Unit price in IRR (decimal string). */
  unitPrice: string
  /** VAT rate in basis points (0..10000). */
  vatRate: number
  /** Whether the line participates in VAT. */
  isTaxable: boolean
  /** Auto invoices: FK products.id. */
  productId?: string
  /** Auto invoices: products.type snapshot. */
  productType?: string
}

/** Per-line arithmetic recorded between inputs and totals. */
export interface InvoiceCalculationLineStep {
  /** 0-based position in the input list. */
  lineIndex: number
  /** Line description (mirrors the input / product title). */
  description: string
  /** Quantity of the priced unit. */
  quantity: number
  /** Unit price in IRR (decimal string). */
  unitPrice: string
  /** `quantity × unitPrice` before discount. */
  gross: string
  /** Pre-VAT discount allocated to this line (`"0"` on manual invoices). */
  discount: string
  /** Remaining order-level discount before this line absorbed its share. */
  remainingDiscountBefore: string
  /** Remaining order-level discount after this line absorbed its share. */
  remainingDiscountAfter: string
  /** Net pre-VAT subtotal (`gross − discount`). */
  lineTotal: string
  /** VAT rounding step applied to `lineTotal`. */
  vat: InvoiceVatRoundingStep
}

/** Final invoice totals in IRR (decimal strings). */
export interface InvoiceCalculationTotals {
  /** Σ lineTotal (net of discounts, before VAT). */
  subtotal: string
  /** Σ vat.rounded. */
  totalVat: string
  /** Σ per-line discount (equals `inputs.orderDiscount` on auto invoices). */
  totalDiscount: string
  /** `subtotal + totalVat` — the invoice `total_amount`. */
  totalAmount: string
}

/**
 * Full calculation snapshot persisted on the invoice row.
 *
 * Replay (T-04.1.02.09): feed `inputs` back into the same calculator and
 * assert the resulting totals equal `totals`.
 */
export interface InvoiceCalculationSnapshot {
  version: typeof INVOICE_CALCULATION_SNAPSHOT_VERSION
  rounding: typeof INVOICE_ROUNDING_RULE
  /** Basis-point scale used as the VAT rounding denominator. */
  vatScale: typeof VAT_BASIS_POINT_SCALE
  source: InvoiceCalculationSource
  inputs: {
    lines: InvoiceCalculationLineInput[]
    /**
     * Order-level gift discount in IRR (decimal string). Always `"0"` on
     * manual invoices; auto invoices record the gift-code amount even when
     * zero so replay has an explicit input.
     */
    orderDiscount: string
  }
  steps: InvoiceCalculationLineStep[]
  totals: InvoiceCalculationTotals
}
