/**
 * Invoice state machine — pure model (T-04.1.01.03).
 *
 * The 9 authoritative invoice states (matching the DB `invoice_state` enum
 * and the S-04.1.01 specification):
 *   Draft → Unpaid → PaymentUnderReview → PartiallyFunded → Paid →
 *   Overdue → Cancelled → PartiallyRefunded → Refunded
 *
 * This module contains ONLY pure, side-effect-free logic: the transition
 * table, guard methods, and transition validation. It intentionally has no
 * database or HTTP dependency so it can be unit-tested exhaustively and
 * reused by any caller (Nest service, workers, seeds).
 *
 * All monetary amounts are bigints (IRR). Floating point is forbidden.
 */

export const INVOICE_STATES = [
  'Draft',
  'Unpaid',
  'PaymentUnderReview',
  'PartiallyFunded',
  'Paid',
  'Overdue',
  'Cancelled',
  'PartiallyRefunded',
  'Refunded',
] as const

export type InvoiceState = (typeof INVOICE_STATES)[number]

/** Named transitions, one per row in the S-04.1.01 specification table. */
export const INVOICE_TRANSITIONS = [
  'Issue',
  'SubmitBankReceipt',
  'ConfirmBankReceipt',
  'PayFromWallet',
  'MarkOverdue',
  'Cancel',
  'PartialRefund',
  'FullRefund',
] as const

export type InvoiceTransition = (typeof INVOICE_TRANSITIONS)[number]

/**
 * Terminal states — a transition INTO one of these closes the invoice.
 * From these states only `PartialRefund` (from `Paid`) is permitted by the
 * spec; `Cancelled` and `Refunded` are hard terminal.
 */
export const INVOICE_TERMINAL_STATES: readonly InvoiceState[] = [
  'Paid',
  'Cancelled',
  'Refunded',
] as const

/**
 * Allowed `to` states for each `from` state.
 *
 * Derived directly from the S-04.1.01 transition table:
 *   - Issue:              Draft              → Unpaid
 *   - SubmitBankReceipt:  Unpaid, Partially, Overdue → PaymentUnderReview
 *   - ConfirmBankReceipt: PaymentUnderReview → Unpaid/PartiallyFunded/Paid
 *   - PayFromWallet:      Unpaid, Partially  → Paid
 *   - MarkOverdue:        Unpaid, Partially  → Overdue
 *   - Cancel:             Unpaid, Overdue, Draft, Partially → Cancelled
 *   - PartialRefund:      Paid, PartiallyRefunded → PartiallyRefunded
 *   - FullRefund:         Paid               → Refunded
 */
export const ALLOWED_TRANSITIONS: Readonly<
  Record<InvoiceState, readonly InvoiceState[]>
> = {
  Draft: ['Unpaid', 'Cancelled'],
  Unpaid: ['PaymentUnderReview', 'Paid', 'Overdue', 'Cancelled'],
  PaymentUnderReview: ['Unpaid', 'PartiallyFunded', 'Paid'],
  PartiallyFunded: ['PaymentUnderReview', 'Paid', 'Overdue', 'Cancelled'],
  Paid: ['PartiallyRefunded', 'Refunded'],
  Overdue: ['PaymentUnderReview', 'Cancelled'],
  Cancelled: [],
  PartiallyRefunded: ['PartiallyRefunded'],
  Refunded: [],
}

/** The named transition that a given `from`→`to` pair corresponds to. */
export const TRANSITION_BY_PAIR: Readonly<
  Record<InvoiceState, Partial<Record<InvoiceState, InvoiceTransition>>>
> = {
  Draft: { Unpaid: 'Issue', Cancelled: 'Cancel' },
  Unpaid: {
    PaymentUnderReview: 'SubmitBankReceipt',
    Paid: 'PayFromWallet',
    Overdue: 'MarkOverdue',
    Cancelled: 'Cancel',
  },
  PaymentUnderReview: {
    Unpaid: 'ConfirmBankReceipt',
    PartiallyFunded: 'ConfirmBankReceipt',
    Paid: 'ConfirmBankReceipt',
  },
  PartiallyFunded: {
    PaymentUnderReview: 'SubmitBankReceipt',
    Paid: 'PayFromWallet',
    Overdue: 'MarkOverdue',
    Cancelled: 'Cancel',
  },
  Paid: { PartiallyRefunded: 'PartialRefund', Refunded: 'FullRefund' },
  Overdue: { PaymentUnderReview: 'SubmitBankReceipt', Cancelled: 'Cancel' },
  Cancelled: {},
  PartiallyRefunded: { PartiallyRefunded: 'PartialRefund' },
  Refunded: {},
}

export interface InvoiceFinancials {
  /** Confirmed (paid) amount in IRR. */
  paidAmount: bigint
  /** Invoice total amount in IRR. */
  totalAmount: bigint
  /** Cumulative refunded amount in IRR. */
  refundedAmount: bigint
}

/**
 * Validation context carrying the financial amounts needed to enforce the
 * S-04.1.01 amount-based rules.
 */
export interface TransitionContext extends InvoiceFinancials {
  /**
   * Optional override for the payment amount being recorded during the
   * transition (e.g. the confirmed bank-receipt amount). When omitted the
   * derived confirmed amount is `paidAmount`.
   */
  incomingPaidAmount?: bigint
}

/** Guard/validation result message. */
export const TRANSITION_ERRORS = {
  UNKNOWN_STATE: (s: string) => `Unknown invoice state: ${s}`,
  NOT_PART_OF_FLOW: (from: InvoiceState, to: InvoiceState) =>
    `Illegal transition from '${from}' to '${to}'`,
  PAID_AMOUNT_TOO_LOW: (paid: bigint, total: bigint) =>
    `Cannot reach Paid: confirmed amount ${paid} is less than total ${total}`,
  REFUNDED_MISMATCH: (refunded: bigint, paid: bigint) =>
    `Cannot reach Refunded: refunded ${refunded} does not equal paid ${paid}`,
  PARTIALLY_FUNDED_ZERO: () =>
    `Cannot enter PartiallyFunded with zero confirmed amount`,
  PARTIALLY_FUNDED_TOO_HIGH: (paid: bigint, total: bigint) =>
    `Cannot enter PartiallyFunded: confirmed amount ${paid} already covers total ${total}`,
  PARTIAL_REFUND_EXCEEDS: (refunded: bigint, paid: bigint) =>
    `Partial refund would make refunded ${refunded} exceed paid ${paid}`,
  NONNEGATIVE_PAID: () => `paidAmount cannot be negative`,
  NONNEGATIVE_REFUNDED: () => `refundedAmount cannot be negative`,
  TOTAL_POSITIVE: () => `totalAmount must be positive`,
  NONNEGATIVE_INCOMING: () => `incoming paid amount cannot be negative`,
  CREDIT_NOT_PAYABLE: (invoiceId: string) =>
    `Invoice ${invoiceId} is a credit note and cannot enter the customer payment flow`,
} as const

/** Validate that a state string is one of the 9 authoritative states. */
export function isInvoiceState(value: string): value is InvoiceState {
  return (INVOICE_STATES as readonly string[]).includes(value)
}

/** Is `from` a state from which `to` may be reached? Pure structural check. */
export function canTransition(from: InvoiceState, to: InvoiceState): boolean {
  return ALLOWED_TRANSITIONS[from].includes(to)
}

/**
 * Numeric guard for a target state given the financial amounts.
 *
 * Enforces the S-04.1.01 amount-based constraints independent of the
 * structural transition table:
 *   - `Paid`           reached only when confirmed >= total
 *   - `Refunded`       requires refunded == paid
 *   - `PartiallyFunded` requires 0 < confirmed < total
 *   - refunds never exceed `paid - refunded`
 *
 * @returns `null` when the target is structurally/numerically reachable,
 *   otherwise the named error message.
 */
export function resolveAmountError(
  to: InvoiceState,
  fin: TransitionContext,
): string | null {
  if (fin.totalAmount <= 0n) return TRANSITION_ERRORS.TOTAL_POSITIVE()
  if (fin.paidAmount < 0n) return TRANSITION_ERRORS.NONNEGATIVE_PAID()
  if (fin.refundedAmount < 0n) return TRANSITION_ERRORS.NONNEGATIVE_REFUNDED()
  const incoming = fin.incomingPaidAmount ?? fin.paidAmount
  if (incoming < 0n) return TRANSITION_ERRORS.NONNEGATIVE_INCOMING()

  // Effective confirmed amount after this transition records `incoming`.
  // For targets reached via the wallet pay path we require the SPEC's
  // confirmed_amount >= total_amount; callers pass paidAmount accordingly.
  switch (to) {
    case 'Paid':
      // Even though a refund history may exist, Paid can be (re)entered from
      // PartiallyFunded/Unpaid with a full settlement; use the effective value.
      if (incoming < fin.totalAmount) {
        return TRANSITION_ERRORS.PAID_AMOUNT_TOO_LOW(incoming, fin.totalAmount)
      }
      return null
    case 'Refunded':
      if (fin.refundedAmount !== fin.paidAmount) {
        return TRANSITION_ERRORS.REFUNDED_MISMATCH(
          fin.refundedAmount,
          fin.paidAmount,
        )
      }
      return null
    case 'PartiallyFunded':
      if (incoming <= 0n) return TRANSITION_ERRORS.PARTIALLY_FUNDED_ZERO()
      if (incoming >= fin.totalAmount) {
        return TRANSITION_ERRORS.PARTIALLY_FUNDED_TOO_HIGH(
          incoming,
          fin.totalAmount,
        )
      }
      return null
    case 'PartiallyRefunded':
      if (fin.refundedAmount > fin.paidAmount) {
        return TRANSITION_ERRORS.PARTIAL_REFUND_EXCEEDS(
          fin.refundedAmount,
          fin.paidAmount,
        )
      }
      return null
    default:
      return null
  }
}

/**
 * Full transition validation: structural + numeric constraints.
 *
 * @throws RangeError when `from` or `to` is not a known state.
 * @throws Error with a TRANSITION_ERRORS message when the transition is not
 *   allowed by the state machine specification.
 */
export function validateTransition(
  from: InvoiceState,
  to: InvoiceState,
  ctx?: TransitionContext,
): void {
  if (!isInvoiceState(from)) throw new RangeError(TRANSITION_ERRORS.UNKNOWN_STATE(from))
  if (!isInvoiceState(to)) throw new RangeError(TRANSITION_ERRORS.UNKNOWN_STATE(to))

  if (!canTransition(from, to)) {
    throw new Error(TRANSITION_ERRORS.NOT_PART_OF_FLOW(from, to))
  }

  if (ctx) {
    const amountError = resolveAmountError(to, ctx)
    if (amountError) throw new Error(amountError)
  }
}

/** Resolve the named transition for a `from`→`to` pair, or null if illegal. */
export function transitionName(
  from: InvoiceState,
  to: InvoiceState,
): InvoiceTransition | null {
  return TRANSITION_BY_PAIR[from]?.[to] ?? null
}

/** Human-readable transition label for audit/user-facing messages. */
export const TRANSITION_LABELS: Record<InvoiceTransition, string> = {
  Issue: 'issue',
  SubmitBankReceipt: 'submit_bank_receipt',
  ConfirmBankReceipt: 'confirm_bank_receipt',
  PayFromWallet: 'pay_from_wallet',
  MarkOverdue: 'mark_overdue',
  Cancel: 'cancel',
  PartialRefund: 'partial_refund',
  FullRefund: 'full_refund',
}