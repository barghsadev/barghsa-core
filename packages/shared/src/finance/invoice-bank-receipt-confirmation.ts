/**
 * Staff invoice bank-receipt confirmation contract (S-04.3.01, T-04.3.01.03).
 *
 * Finance staff confirm a Submitted / UnderReview `bank_receipts` row.
 * The receipt is applied up to invoice remaining (`paidAmount` never
 * exceeds `totalAmount`). Any excess is a separate verified profile-wallet
 * credit with its own idempotency key — not invoice over-settlement.
 *
 * Dual-approval (T-04.3.01.05) and rejection (T-04.3.01.04) are later
 * tasks. This contract covers confirmation, allocation, and the excess
 * credit key/metadata only.
 *
 * @module finance
 */

import type { BankReceiptOverpaymentSnapshot } from './invoice-overpayment.js'

/** Capability gate documented on the staff API (mapped to isAdmin today). */
export const INVOICE_BANK_RECEIPT_CONFIRM_PERMISSION =
  'admin:finance:invoices:bank-receipt-confirm' as const

/** Canonical audit event when staff confirm an invoice bank receipt. */
export const INVOICE_BANK_RECEIPT_CONFIRMED_EVENT =
  'invoice.bank_receipt.confirmed' as const

/** Channel discriminator stored on the excess wallet-credit ledger row. */
export const INVOICE_BANK_RECEIPT_CHANNEL = 'invoice_bank_receipt' as const

/** Receipt states from which finance may confirm. */
export const INVOICE_BANK_RECEIPT_CONFIRMABLE_STATES = [
  'Submitted',
  'UnderReview',
] as const

export type InvoiceBankReceiptConfirmableState =
  (typeof INVOICE_BANK_RECEIPT_CONFIRMABLE_STATES)[number]

/** Human-readable description on the Completed overpayment credit row. */
export const INVOICE_BANK_RECEIPT_OVERPAYMENT_CREDIT_DESCRIPTION =
  'Invoice bank receipt overpayment wallet credit'

export const INVOICE_BANK_RECEIPT_CONFIRM_ERRORS = {
  NOT_CONFIRMABLE: (state: string) =>
    `Invoice bank receipt cannot be confirmed while it is ${state}`,
  ALREADY_CONFIRMED: () => 'Invoice bank receipt has already been confirmed',
  ALREADY_REJECTED: () => 'Invoice bank receipt has already been rejected',
  CREDIT_NOTE: () => 'Credit notes cannot receive a bank-receipt allocation',
} as const

export function isInvoiceBankReceiptConfirmableState(
  state: string,
): state is InvoiceBankReceiptConfirmableState {
  return (INVOICE_BANK_RECEIPT_CONFIRMABLE_STATES as readonly string[]).includes(
    state,
  )
}

/**
 * Distinct from `bankReceiptOverpaymentCreditIdempotencyKey` (wallet
 * pending ledger ids) so invoice-receipt credits cannot collide with
 * wallet-top-up overpayment credits.
 */
export function invoiceBankReceiptOverpaymentCreditIdempotencyKey(
  receiptId: string,
): string {
  return `invoice-bank-receipt-overpayment-credit:${receiptId}`
}

export function invoiceBankReceiptOverpaymentCreditMetadata(input: {
  receiptId: string
  invoiceId: string
  confirmedBy: string
  confirmedAt: Date
  invoiceAllocation: bigint
  walletCreditAmount: bigint
  remainingBefore: bigint
}): Record<string, unknown> {
  return {
    channel: INVOICE_BANK_RECEIPT_CHANNEL,
    purpose: 'overpayment',
    receiptId: input.receiptId,
    invoiceId: input.invoiceId,
    confirmedBy: input.confirmedBy,
    confirmedAt: input.confirmedAt.toISOString(),
    invoiceAllocation: input.invoiceAllocation.toString(),
    walletCreditAmount: input.walletCreditAmount.toString(),
    remainingBefore: input.remainingBefore.toString(),
  }
}

export function readInvoiceBankReceiptOverpaymentFromCreditMetadata(
  metadata: unknown,
): BankReceiptOverpaymentSnapshot | null {
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) {
    return null
  }
  const snap = metadata as Record<string, unknown>
  if (snap.channel !== INVOICE_BANK_RECEIPT_CHANNEL) return null
  if (typeof snap.invoiceId !== 'string') return null
  if (typeof snap.remainingBefore !== 'string') return null
  if (typeof snap.invoiceAllocation !== 'string') return null
  if (typeof snap.walletCreditAmount !== 'string') return null
  return {
    invoiceId: snap.invoiceId,
    remainingBefore: snap.remainingBefore,
    invoiceAllocation: snap.invoiceAllocation,
    walletCreditAmount: snap.walletCreditAmount,
    overpaymentCreditTransactionId:
      typeof snap.overpaymentCreditTransactionId === 'string'
        ? snap.overpaymentCreditTransactionId
        : null,
  }
}
