/**
 * Post-payment adjustment invoices (T-04.1.05.03 / S-04.1.05).
 *
 * Positive amounts are additional charges (customer payables). Negative
 * amounts are credit notes: they reduce net customer liability and must
 * never enter the ordinary invoice-payment flow.
 *
 * `invoices.total_amount` stays non-negative. The signed contribution is
 * `invoices.accounting_amount` (generated: `-total_amount` when
 * `adjustment_kind = 'credit'`). Downstream outstanding and payment
 * queries must use these helpers rather than treating every Unpaid row
 * as customer debt.
 *
 * @module finance
 */

/** First-class discriminator stored on adjustment invoices. */
export const ADJUSTMENT_KINDS = ['charge', 'credit'] as const

export type AdjustmentKind = (typeof ADJUSTMENT_KINDS)[number]

/**
 * State-machine transitions that collect or chase customer payment.
 * Credit notes are excluded from all of them.
 */
export const CUSTOMER_PAYMENT_TRANSITIONS = [
  'PayFromWallet',
  'SubmitBankReceipt',
  'MarkOverdue',
] as const

export type CustomerPaymentTransition =
  (typeof CUSTOMER_PAYMENT_TRANSITIONS)[number]

/** Invoice states that represent open customer payables (charges only). */
export const CUSTOMER_PAYABLE_STATES = [
  'Unpaid',
  'Overdue',
  'PartiallyFunded',
] as const

export type CustomerPayableState = (typeof CUSTOMER_PAYABLE_STATES)[number]

export function isAdjustmentKind(value: string | null | undefined): value is AdjustmentKind {
  return value === 'charge' || value === 'credit'
}

export function isCreditAdjustmentKind(
  value: string | null | undefined,
): boolean {
  return value === 'credit'
}

export function isCustomerPaymentTransition(
  value: string | null | undefined,
): value is CustomerPaymentTransition {
  return (CUSTOMER_PAYMENT_TRANSITIONS as readonly string[]).includes(
    value ?? '',
  )
}

/**
 * True when the invoice is an open customer payable. Credit notes are
 * never payable even when issued Unpaid.
 */
export function isCustomerPayableInvoice(input: {
  state: string
  adjustmentKind?: string | null
}): boolean {
  if (isCreditAdjustmentKind(input.adjustmentKind)) return false
  return (CUSTOMER_PAYABLE_STATES as readonly string[]).includes(input.state)
}

/**
 * Dashboard unpaid-invoice count predicate. Excludes credit notes so a
 * negative adjustment cannot inflate the customer's outstanding count.
 */
export const UNPAID_CUSTOMER_INVOICE_PREDICATE =
  `state IN ('Unpaid', 'Overdue') AND adjustment_kind IS DISTINCT FROM 'credit'` as const

/**
 * Signed outstanding IRR for a profile.
 *
 * - Open charge invoices contribute `total_amount - paid_amount`.
 * - Issued (non-cancelled) credits contribute negative `accounting_amount`.
 * - Paid originals contribute 0 (already settled).
 */
export const NET_CUSTOMER_LIABILITY_SELECT = `COALESCE(SUM(
  CASE
    WHEN adjustment_kind = 'credit' AND state <> 'Cancelled'::invoice_state
      THEN accounting_amount
    WHEN adjustment_kind IS DISTINCT FROM 'credit'
         AND state IN ('Unpaid', 'Overdue', 'PartiallyFunded')
      THEN total_amount - paid_amount
    ELSE 0
  END
), 0)::bigint` as const
