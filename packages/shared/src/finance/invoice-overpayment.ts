/**
 * Bank-receipt overpayment allocation (S-04.2.02, T-04.2.02.05).
 *
 * Staff may confirm a receipt whose face amount exceeds the invoice
 * remaining balance. The invoice is settled only up to remaining
 * (`paidAmount` never exceeds `totalAmount`). Any excess is a separate
 * verified profile-wallet credit with its own idempotency key — not
 * invoice over-settlement.
 *
 * @module finance
 */

import { BANK_RECEIPT_TOPUP_CHANNEL } from './wallet-bank-receipt-topup.js'

/**
 * Invoice states that can still absorb a bank-receipt allocation.
 * Paid / Cancelled / Refunded / Draft contribute remaining = 0, so the
 * whole receipt becomes a wallet credit.
 */
export const BANK_RECEIPT_SETTLEABLE_INVOICE_STATES = [
  'Unpaid',
  'PaymentUnderReview',
  'PartiallyFunded',
  'Overdue',
] as const

export type BankReceiptSettleableInvoiceState =
  (typeof BANK_RECEIPT_SETTLEABLE_INVOICE_STATES)[number]

/** Human-readable description on the Completed overpayment credit row. */
export const BANK_RECEIPT_OVERPAYMENT_CREDIT_DESCRIPTION =
  'Bank receipt overpayment wallet credit'

export const BANK_RECEIPT_OVERPAYMENT_ERRORS = {
  BAD_RECEIPT_AMOUNT: () => 'Receipt amount must be a positive integer IRR value',
  BAD_REMAINING: () => 'Invoice remaining must be a non-negative integer IRR value',
  BAD_INVOICE_ID: () => 'invoiceId must be a UUID when applying a receipt to an invoice',
  PROFILE_MISMATCH: () => 'Invoice does not belong to this wallet profile',
  CANNOT_OVERSETTLE: () =>
    'Invoice remaining changed; the receipt would over-settle the invoice',
} as const

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export interface ReceiptAgainstInvoiceAllocation {
  invoiceAllocation: bigint
  walletCreditAmount: bigint
  isOverpayment: boolean
}

export interface BankReceiptOverpaymentSnapshot {
  invoiceId: string
  remainingBefore: string
  invoiceAllocation: string
  walletCreditAmount: string
  overpaymentCreditTransactionId: string | null
}

export interface ParseOptionalInvoiceIdSuccess {
  ok: true
  invoiceId: string | null
}

export interface ParseOptionalInvoiceIdFailure {
  ok: false
  message: string
}

export type ParseOptionalInvoiceIdResult =
  | ParseOptionalInvoiceIdSuccess
  | ParseOptionalInvoiceIdFailure

/**
 * Remaining payable IRR. Never negative: a paid-in-full invoice has
 * remaining 0 even if callers pass a stale paidAmount.
 */
export function invoiceRemainingAmount(totalAmount: bigint, paidAmount: bigint): bigint {
  if (totalAmount < 0n || paidAmount < 0n) return 0n
  return totalAmount > paidAmount ? totalAmount - paidAmount : 0n
}

export function isBankReceiptSettleableInvoiceState(
  state: string,
): state is BankReceiptSettleableInvoiceState {
  return (BANK_RECEIPT_SETTLEABLE_INVOICE_STATES as readonly string[]).includes(state)
}

/**
 * Remaining that a bank receipt may allocate onto an invoice. Non-settleable
 * states (Paid, Cancelled, …) return 0 so the receipt cannot over-settle
 * and the full amount is treated as wallet excess.
 */
export function remainingForBankReceiptSettlement(input: {
  totalAmount: bigint
  paidAmount: bigint
  state: string
}): bigint {
  if (!isBankReceiptSettleableInvoiceState(input.state)) return 0n
  return invoiceRemainingAmount(input.totalAmount, input.paidAmount)
}

/**
 * Durable invoice state after a positive bank-receipt allocation.
 * Callers then take the validated ConfirmBankReceipt path
 * (SubmitBankReceipt into PaymentUnderReview when needed, then confirm).
 */
export function invoiceStateAfterBankReceiptAllocation(input: {
  paidAmount: bigint
  totalAmount: bigint
}): 'Paid' | 'PartiallyFunded' {
  return input.paidAmount >= input.totalAmount ? 'Paid' : 'PartiallyFunded'
}

/**
 * Split a confirmed receipt into invoice settlement vs wallet excess.
 *
 * `invoiceAllocation = min(receiptAmount, remaining)`
 * `walletCreditAmount = receiptAmount - invoiceAllocation`
 */
export function allocateReceiptAgainstInvoice(input: {
  receiptAmount: bigint
  remaining: bigint
}): ReceiptAgainstInvoiceAllocation {
  if (input.receiptAmount <= 0n) {
    throw new RangeError(BANK_RECEIPT_OVERPAYMENT_ERRORS.BAD_RECEIPT_AMOUNT())
  }
  if (input.remaining < 0n) {
    throw new RangeError(BANK_RECEIPT_OVERPAYMENT_ERRORS.BAD_REMAINING())
  }
  const invoiceAllocation =
    input.receiptAmount < input.remaining ? input.receiptAmount : input.remaining
  const walletCreditAmount = input.receiptAmount - invoiceAllocation
  return {
    invoiceAllocation,
    walletCreditAmount,
    isOverpayment: walletCreditAmount > 0n,
  }
}

/**
 * Distinct from `bankReceiptCreditIdempotencyKey` so the excess credit
 * cannot collide with a full wallet-top-up credit of the same pending row.
 */
export function bankReceiptOverpaymentCreditIdempotencyKey(
  pendingTransactionId: string,
): string {
  return `wallet-bank-receipt-overpayment-credit:${pendingTransactionId}`
}

export function parseOptionalInvoiceId(raw: unknown): ParseOptionalInvoiceIdResult {
  if (raw === undefined || raw === null) {
    return { ok: true, invoiceId: null }
  }
  if (typeof raw !== 'object' || Array.isArray(raw)) {
    return { ok: false, message: BANK_RECEIPT_OVERPAYMENT_ERRORS.BAD_INVOICE_ID() }
  }
  const value = (raw as { invoiceId?: unknown }).invoiceId
  if (value === undefined || value === null || value === '') {
    return { ok: true, invoiceId: null }
  }
  if (typeof value !== 'string' || !UUID_RE.test(value.trim())) {
    return { ok: false, message: BANK_RECEIPT_OVERPAYMENT_ERRORS.BAD_INVOICE_ID() }
  }
  return { ok: true, invoiceId: value.trim().toLowerCase() }
}

export function bankReceiptOverpaymentCreditMetadata(input: {
  pendingTransactionId: string
  invoiceId: string
  confirmedBy: string
  confirmedAt: Date
  invoiceAllocation: bigint
  walletCreditAmount: bigint
  remainingBefore: bigint
}): Record<string, unknown> {
  return {
    channel: BANK_RECEIPT_TOPUP_CHANNEL,
    purpose: 'overpayment',
    pendingTransactionId: input.pendingTransactionId,
    invoiceId: input.invoiceId,
    confirmedBy: input.confirmedBy,
    confirmedAt: input.confirmedAt.toISOString(),
    invoiceAllocation: input.invoiceAllocation.toString(),
    walletCreditAmount: input.walletCreditAmount.toString(),
    remainingBefore: input.remainingBefore.toString(),
  }
}

export function bankReceiptOverpaymentSnapshot(input: {
  invoiceId: string
  remainingBefore: bigint
  invoiceAllocation: bigint
  walletCreditAmount: bigint
  overpaymentCreditTransactionId: string | null
}): BankReceiptOverpaymentSnapshot {
  return {
    invoiceId: input.invoiceId,
    remainingBefore: input.remainingBefore.toString(),
    invoiceAllocation: input.invoiceAllocation.toString(),
    walletCreditAmount: input.walletCreditAmount.toString(),
    overpaymentCreditTransactionId: input.overpaymentCreditTransactionId,
  }
}

export function readBankReceiptOverpaymentSnapshot(
  metadata: unknown,
): BankReceiptOverpaymentSnapshot | null {
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) return null
  const record = (metadata as { overpayment?: unknown }).overpayment
  if (!record || typeof record !== 'object' || Array.isArray(record)) return null
  const snap = record as Record<string, unknown>
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
