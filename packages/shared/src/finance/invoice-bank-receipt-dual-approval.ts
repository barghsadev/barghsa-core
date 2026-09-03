/**
 * Dual-approval gate for invoice bank-receipt confirmation (T-04.3.01.05).
 *
 * When the receipt amount is **≥** the admin-configured
 * `finance.dual_approval_threshold` and that threshold is enabled
 * (`thresholdIrR > 0`), the first finance staff confirmation parks the
 * receipt in `UnderReview` and records a `bank_payment_confirmation`
 * approval request. A second, different finance staff member must confirm
 * before the receipt can settle, credit the wallet, or change invoice
 * `paid_amount`.
 *
 * Comparison is at-or-above (S-04.3.01 / C-04.CC.02). The generic
 * T-09.07.02 helper `shouldRequireDualApproval` uses a strict `>` and JS
 * numbers; bank receipts compare bigint IRR amounts from `bank_receipts`.
 *
 * A stored threshold of `0` or a missing `app_config` row means dual
 * approval is disabled. A present-but-corrupt row is **not** treated as
 * disabled — callers must fail the confirmation closed.
 *
 * A DualApprovalService rejection of the latest request is terminal for
 * that receipt: confirmation must not create a replacement pending
 * request. The receipt is synchronized to `Rejected` instead.
 *
 * @module finance
 */

import {
  isValidDualApprovalThreshold,
} from './dual-approval-config.js'
import { BANK_RECEIPT_REJECT_REASON_MAX_LENGTH } from './wallet-bank-receipt-confirmation.js'

/** Approval-request action covering bank-payment confirmations (T-09.07.01). */
export const INVOICE_BANK_RECEIPT_DUAL_APPROVAL_ACTION_TYPE =
  'bank_payment_confirmation' as const

/** Canonical audit event when the first staff parks a dual-approval confirm. */
export const INVOICE_BANK_RECEIPT_DUAL_APPROVAL_REQUESTED_EVENT =
  'invoice.bank_receipt.dual_approval_requested' as const

/** Human-readable reason stored on the approval_requests row. */
export const INVOICE_BANK_RECEIPT_DUAL_APPROVAL_REASON =
  'Invoice bank receipt confirmation' as const

export const INVOICE_BANK_RECEIPT_DUAL_APPROVAL_ERRORS = {
  SAME_STAFF: () =>
    'A second, different finance staff member must confirm this receipt because its amount meets the dual-approval threshold',
  CONFIG_CORRUPT: () =>
    'Dual-approval threshold configuration is invalid; invoice bank-receipt confirmation is blocked',
  APPROVAL_REJECTED: () =>
    'Invoice bank-receipt dual approval was rejected; confirmation cannot restart the approval workflow',
} as const

/** Fallback customer-visible reason when the approval-request review reason is blank. */
export const INVOICE_BANK_RECEIPT_DUAL_APPROVAL_REJECTED_REASON =
  'Dual-approval request was rejected' as const

/**
 * Map a DualApprovalService review reason onto a `bank_receipts.rejection_reason`.
 * Blank values fall back to {@link INVOICE_BANK_RECEIPT_DUAL_APPROVAL_REJECTED_REASON}
 * so the receipt CHECK constraint always receives a non-empty reason.
 */
export function invoiceBankReceiptReasonFromDualApprovalRejection(
  reviewReason: string | null | undefined,
): string {
  const trimmed = typeof reviewReason === 'string' ? reviewReason.trim() : ''
  if (trimmed.length === 0) {
    return INVOICE_BANK_RECEIPT_DUAL_APPROVAL_REJECTED_REASON
  }
  if (trimmed.length > BANK_RECEIPT_REJECT_REASON_MAX_LENGTH) {
    return trimmed.slice(0, BANK_RECEIPT_REJECT_REASON_MAX_LENGTH)
  }
  return trimmed
}

/** Result of reading the persisted dual-approval threshold for this gate. */
export type InvoiceBankReceiptDualApprovalThresholdRead =
  | { status: 'disabled'; thresholdIrR: 0 }
  | { status: 'enabled'; thresholdIrR: number }
  | { status: 'corrupt' }

/**
 * Normalize a raw `app_config` value (or a missing row) into the
 * dual-approval threshold read used by invoice bank-receipt confirmation.
 *
 * `undefined` / `null` means no row — disabled default. A row that does
 * not contain a valid non-negative safe-integer threshold is corrupt.
 */
export function readInvoiceBankReceiptDualApprovalThreshold(
  raw: unknown,
): InvoiceBankReceiptDualApprovalThresholdRead {
  if (raw === undefined || raw === null) {
    return { status: 'disabled', thresholdIrR: 0 }
  }
  if (typeof raw !== 'object' || Array.isArray(raw)) {
    return { status: 'corrupt' }
  }
  const o = raw as Record<string, unknown>
  const value = o.threshold_irr ?? o.thresholdIrR
  if (!isValidDualApprovalThreshold(value)) {
    return { status: 'corrupt' }
  }
  if (value === 0) {
    return { status: 'disabled', thresholdIrR: 0 }
  }
  return { status: 'enabled', thresholdIrR: value }
}

/**
 * Whether a receipt of `amountIrR` IRR must wait for a second finance
 * staff confirmation under `read`.
 *
 * Corrupt reads return `false` here so the caller can fail closed
 * separately rather than silently skipping the gate.
 */
export function invoiceBankReceiptRequiresDualApproval(
  read: InvoiceBankReceiptDualApprovalThresholdRead,
  amountIrR: bigint,
): boolean {
  if (read.status !== 'enabled') return false
  if (amountIrR <= 0n) return false
  return amountIrR >= BigInt(read.thresholdIrR)
}

/** JSONB `details` payload stored on the approval_requests row. */
export function invoiceBankReceiptDualApprovalDetails(input: {
  receiptId: string
  invoiceId: string
  profileId: string
}): Record<string, string> {
  return {
    receiptId: input.receiptId,
    invoiceId: input.invoiceId,
    profileId: input.profileId,
    entityType: 'invoice_bank_receipt',
  }
}

/** Read the receipt id back out of an approval-request details object. */
export function receiptIdFromInvoiceBankReceiptDualApprovalDetails(
  details: unknown,
): string | null {
  if (!details || typeof details !== 'object' || Array.isArray(details)) {
    return null
  }
  const receiptId = (details as Record<string, unknown>).receiptId
  return typeof receiptId === 'string' && receiptId.length > 0 ? receiptId : null
}
