/**
 * Wallet-to-invoice payment helpers (S-04.2.03, T-04.2.03.01).
 *
 * A wallet payment is a single full debit of the invoice remaining
 * amount. It is enabled only from Unpaid / PartiallyFunded (not credit
 * notes) when `availableBalance >= remaining`. The service method
 * `payInvoiceWithWallet` uses these helpers for remaining, eligibility,
 * and ledger metadata.
 *
 * @module finance
 */

import { invoiceRemainingAmount } from './invoice-overpayment.js'

/**
 * Invoice states that may be settled by PayFromWallet
 * (S-04.1.01 / S-04.2.03). Overdue cannot PayFromWallet.
 */
export const WALLET_PAYABLE_INVOICE_STATES = [
  'Unpaid',
  'PartiallyFunded',
] as const

export type WalletPayableInvoiceState =
  (typeof WALLET_PAYABLE_INVOICE_STATES)[number]

/** Human-readable description on the Completed payment debit row. */
export const PAY_INVOICE_WITH_WALLET_DESCRIPTION =
  'Wallet payment of invoice remaining balance'

export const PAY_INVOICE_WITH_WALLET_ERRORS = {
  BAD_INVOICE_ID: () => 'invoiceId must be a UUID',
  BAD_PROFILE_ID: () => 'profileId must be a UUID',
  IDEMPOTENCY_REQUIRED: () => 'Idempotency key is required',
  PROFILE_MISMATCH: () => 'Invoice does not belong to this wallet profile',
  INSUFFICIENT_BALANCE: (available: bigint, required: bigint) =>
    `Insufficient balance: available=${available.toString()}, required=${required.toString()}`,
  NOTHING_TO_PAY: () => 'Invoice has no remaining amount to pay from the wallet',
  STATE_NOT_PAYABLE: (state: string) =>
    `Invoice in state '${state}' cannot be paid from the wallet`,
  CREDIT_NOT_PAYABLE: (invoiceId: string) =>
    `Invoice ${invoiceId} is a credit note and cannot enter the customer payment flow`,
  NOT_YET_PAYABLE: (payableFrom: string) =>
    `Invoice is not payable until ${payableFrom}`,
  ALREADY_PAID: () => 'Invoice is already paid',
} as const

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export interface ParsePayInvoiceWithWalletIdsSuccess {
  ok: true
  invoiceId: string
  profileId: string
}

export interface ParsePayInvoiceWithWalletIdsFailure {
  ok: false
  message: string
}

export type ParsePayInvoiceWithWalletIdsResult =
  | ParsePayInvoiceWithWalletIdsSuccess
  | ParsePayInvoiceWithWalletIdsFailure

export interface PayInvoiceWithWalletLedgerSnapshot {
  purpose: 'invoice_payment'
  invoiceId: string
  remainingBefore: string
  paidAmountAfter: string
}

export function isWalletPayableInvoiceState(
  state: string,
): state is WalletPayableInvoiceState {
  return (WALLET_PAYABLE_INVOICE_STATES as readonly string[]).includes(state)
}

/**
 * Remaining IRR a wallet payment may debit. Non-payable states
 * (Paid, Overdue, credit notes, …) return 0 so callers cannot
 * debit against an invoice that PayFromWallet forbids.
 */
export function remainingForWalletPayment(input: {
  totalAmount: bigint
  paidAmount: bigint
  state: string
  adjustmentKind?: string | null
}): bigint {
  if (input.adjustmentKind === 'credit') return 0n
  if (!isWalletPayableInvoiceState(input.state)) return 0n
  return invoiceRemainingAmount(input.totalAmount, input.paidAmount)
}

export function parsePayInvoiceWithWalletIds(
  invoiceId: unknown,
  profileId: unknown,
): ParsePayInvoiceWithWalletIdsResult {
  if (typeof invoiceId !== 'string' || !UUID_RE.test(invoiceId.trim())) {
    return { ok: false, message: PAY_INVOICE_WITH_WALLET_ERRORS.BAD_INVOICE_ID() }
  }
  if (typeof profileId !== 'string' || !UUID_RE.test(profileId.trim())) {
    return { ok: false, message: PAY_INVOICE_WITH_WALLET_ERRORS.BAD_PROFILE_ID() }
  }
  return {
    ok: true,
    invoiceId: invoiceId.trim().toLowerCase(),
    profileId: profileId.trim().toLowerCase(),
  }
}

export function payInvoiceWithWalletMetadata(input: {
  invoiceId: string
  remainingBefore: bigint
  paidAmountAfter: bigint
}): PayInvoiceWithWalletLedgerSnapshot {
  return {
    purpose: 'invoice_payment',
    invoiceId: input.invoiceId,
    remainingBefore: input.remainingBefore.toString(),
    paidAmountAfter: input.paidAmountAfter.toString(),
  }
}

export function isMatchingWalletInvoicePayment(input: {
  walletId: string
  expectedWalletId: string
  invoiceId: string
  type: string
  state: string
  refId: string | null
  amount: bigint
}): boolean {
  return (
    input.walletId === input.expectedWalletId &&
    input.state === 'Completed' &&
    input.type === 'payment' &&
    input.refId === input.invoiceId &&
    input.amount < 0n
  )
}
