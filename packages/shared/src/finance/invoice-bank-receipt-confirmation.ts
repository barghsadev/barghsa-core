/**
 * Staff invoice bank-receipt confirmation and rejection contract
 * (S-04.3.01, T-04.3.01.03 / T-04.3.01.04).
 *
 * Finance staff confirm or reject a Submitted / UnderReview
 * `bank_receipts` row. Confirm applies the receipt up to invoice
 * remaining (`paidAmount` never exceeds `totalAmount`); any excess is a
 * separate verified profile-wallet credit. Reject stores a
 * customer-visible reason, never changes invoice or wallet balances, and
 * enqueues a customer notification.
 *
 * Dual-approval (T-04.3.01.05) is a later task.
 *
 * @module finance
 */

import type { NotificationChannel } from '../notifications/notification-transport.js'
import type { BankReceiptOverpaymentSnapshot } from './invoice-overpayment.js'
import {
  BANK_RECEIPT_REJECT_REASON_MAX_LENGTH,
  BANK_RECEIPT_REJECT_REASON_MIN_LENGTH,
  type ParseRejectReasonResult,
} from './wallet-bank-receipt-confirmation.js'

/** Capability gate documented on the staff API (mapped to isAdmin today). */
export const INVOICE_BANK_RECEIPT_CONFIRM_PERMISSION =
  'admin:finance:invoices:bank-receipt-confirm' as const

/** Canonical audit event when staff confirm an invoice bank receipt. */
export const INVOICE_BANK_RECEIPT_CONFIRMED_EVENT =
  'invoice.bank_receipt.confirmed' as const

/** Canonical audit event when staff reject an invoice bank receipt. */
export const INVOICE_BANK_RECEIPT_REJECTED_EVENT =
  'invoice.bank_receipt.rejected' as const

/**
 * Customer notification event (E-05 registry). Distinct from the audit
 * event so template lookup stays on the `payment.*` namespace.
 */
export const INVOICE_BANK_RECEIPT_REJECTED_NOTIFICATION_EVENT_KEY =
  'payment.bank_receipt_rejected' as const

/** In-app is the customer push; email is the durable fallback. */
export const INVOICE_BANK_RECEIPT_REJECT_CHANNELS: readonly NotificationChannel[] =
  ['in_app', 'email']

/** Customer invoice-detail deep-link persisted onto the in-app push. */
export const INVOICE_BANK_RECEIPT_REJECT_CUSTOMER_ROUTE_PREFIX =
  '/invoices/' as const

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

export const INVOICE_BANK_RECEIPT_REJECT_ERRORS = {
  BAD_REASON: () =>
    `reason is required (${BANK_RECEIPT_REJECT_REASON_MIN_LENGTH}–${BANK_RECEIPT_REJECT_REASON_MAX_LENGTH} characters) and is customer-visible`,
  NOT_REJECTABLE: (state: string) =>
    `Invoice bank receipt cannot be rejected while it is ${state}`,
  OWNER_UNNOTIFIABLE: () =>
    'Invoice bank receipt cannot be rejected because the customer owner cannot be notified',
} as const

/** Receipt states from which finance may reject (same as confirmable). */
export const INVOICE_BANK_RECEIPT_REJECTABLE_STATES =
  INVOICE_BANK_RECEIPT_CONFIRMABLE_STATES

export type InvoiceBankReceiptRejectableState = InvoiceBankReceiptConfirmableState

export function isInvoiceBankReceiptConfirmableState(
  state: string,
): state is InvoiceBankReceiptConfirmableState {
  return (INVOICE_BANK_RECEIPT_CONFIRMABLE_STATES as readonly string[]).includes(
    state,
  )
}

export function isInvoiceBankReceiptRejectableState(
  state: string,
): state is InvoiceBankReceiptRejectableState {
  return isInvoiceBankReceiptConfirmableState(state)
}

/**
 * Parse the customer-visible rejection reason. Blank / oversized /
 * control-character values are rejected.
 */
export function parseInvoiceBankReceiptRejectReason(
  raw: unknown,
): ParseRejectReasonResult {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { ok: false, message: INVOICE_BANK_RECEIPT_REJECT_ERRORS.BAD_REASON() }
  }
  const body = raw as Record<string, unknown>
  const value = body.reason
  if (typeof value !== 'string') {
    return { ok: false, message: INVOICE_BANK_RECEIPT_REJECT_ERRORS.BAD_REASON() }
  }
  const trimmed = value.trim()
  if (
    trimmed.length < BANK_RECEIPT_REJECT_REASON_MIN_LENGTH ||
    trimmed.length > BANK_RECEIPT_REJECT_REASON_MAX_LENGTH
  ) {
    return { ok: false, message: INVOICE_BANK_RECEIPT_REJECT_ERRORS.BAD_REASON() }
  }
  if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(trimmed)) {
    return { ok: false, message: INVOICE_BANK_RECEIPT_REJECT_ERRORS.BAD_REASON() }
  }
  return { ok: true, reason: trimmed }
}

/** Outbox idempotency key: one logical customer notice per receipt. */
export function invoiceBankReceiptRejectedNotificationIdempotencyKey(
  receiptId: string,
): string {
  return `${INVOICE_BANK_RECEIPT_REJECTED_NOTIFICATION_EVENT_KEY}:${receiptId}`
}

export function invoiceBankReceiptRejectedCustomerRoute(invoiceId: string): string {
  return `${INVOICE_BANK_RECEIPT_REJECT_CUSTOMER_ROUTE_PREFIX}${invoiceId}`
}

export interface InvoiceBankReceiptRejectedNotificationPayload {
  receipt_id: string
  invoice_id: string
  amount_irr: string
  reason: string
  rejected_at: string
  /** Relative customer invoice-detail route persisted onto the in-app push. */
  link_route: string
}

export function buildInvoiceBankReceiptRejectedNotificationPayload(input: {
  receiptId: string
  invoiceId: string
  amount: string
  reason: string
  rejectedAt: Date
}): InvoiceBankReceiptRejectedNotificationPayload {
  return {
    receipt_id: input.receiptId,
    invoice_id: input.invoiceId,
    amount_irr: input.amount,
    reason: input.reason,
    rejected_at: input.rejectedAt.toISOString(),
    link_route: invoiceBankReceiptRejectedCustomerRoute(input.invoiceId),
  }
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
