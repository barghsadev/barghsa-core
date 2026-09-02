/**
 * Wallet-to-invoice payment helpers (S-04.2.03, T-04.2.03.01 / T-04.2.03.02).
 *
 * A wallet payment is a single full debit of the invoice remaining
 * amount. It is enabled only from Unpaid / PartiallyFunded (not credit
 * notes) when `availableBalance >= remaining`. The service method
 * `payInvoiceWithWallet` uses these helpers for remaining, eligibility,
 * available-balance gating, ledger metadata, and the
 * `(idempotencyKey, entityType)` cached-response contract
 * (T-04.2.03.03). The DB transaction claims that unique row, then
 * `SELECT … FOR UPDATE`s the wallet and invoice before debiting.
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

/**
 * `idempotency_keys.entity_type` for `payInvoiceWithWallet`
 * (T-04.2.03.03). Unique together with the client key.
 */
export const INVOICE_WALLET_PAYMENT_ENTITY_TYPE = 'invoice_wallet_payment' as const

/** Unique index name on `(idempotency_key, entity_type)`. */
export const IDEMPOTENCY_KEYS_UNIQUE_INDEX = 'uq_idempotency_keys_key_entity_type'

/** C-04.CC.01 default TTL for cached idempotency responses. */
export const IDEMPOTENCY_KEY_TTL_MS = 24 * 60 * 60 * 1000

export const PAY_INVOICE_WITH_WALLET_ERRORS = {
  BAD_INVOICE_ID: () => 'invoiceId must be a UUID',
  BAD_PROFILE_ID: () => 'profileId must be a UUID',
  IDEMPOTENCY_REQUIRED: () => 'Idempotency key is required',
  IDEMPOTENCY_IN_FLIGHT: () => 'Idempotency key is already in flight',
  IDEMPOTENCY_COLLISION: () =>
    'Idempotency key already used for a different wallet operation',
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

/**
 * Derived available balance (`posted − reserved`). Never stored
 * (T-04.2.01.01 / T-04.2.03.02).
 */
export function walletAvailableBalance(
  postedBalance: bigint,
  reservedBalance: bigint,
): bigint {
  return postedBalance - reservedBalance
}

/**
 * A wallet payment is enabled only when the locked wallet's derived
 * availableBalance covers the exact remaining invoice amount
 * (T-04.2.03.02 / S-04.2.03). `remaining <= 0` is not payable.
 */
export function availableCoversRemaining(
  available: bigint,
  remaining: bigint,
): boolean {
  return remaining > 0n && available >= remaining
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

export interface PayInvoiceWithWalletCachedLedger {
  id: string
  walletId: string
  type: string
  amount: string
  state: string
  idempotencyKey: string
  refId: string | null
  description: string | null
  metadata: unknown
  createdAt: string
  updatedAt: string
}

/** JSONB snapshot stored on `idempotency_keys.response`. */
export interface PayInvoiceWithWalletCachedResponse {
  invoiceId: string
  profileId: string
  fromState: string
  toState: 'Paid'
  remainingPaid: string
  walletTransaction: PayInvoiceWithWalletCachedLedger
  auditId: string
}

export function idempotencyKeyExpiresAt(
  now: Date,
  ttlMs: number = IDEMPOTENCY_KEY_TTL_MS,
): Date {
  return new Date(now.getTime() + ttlMs)
}

export function serializePayInvoiceWithWalletCache(input: {
  invoiceId: string
  profileId: string
  fromState: string
  remainingPaid: bigint
  walletTransaction: {
    id: string
    walletId: string
    type: string
    amount: bigint
    state: string
    idempotencyKey: string
    refId: string | null
    description: string | null
    metadata: unknown
    createdAt: Date
    updatedAt: Date
  }
  auditId: string
}): PayInvoiceWithWalletCachedResponse {
  const tx = input.walletTransaction
  return {
    invoiceId: input.invoiceId,
    profileId: input.profileId,
    fromState: input.fromState,
    toState: 'Paid',
    remainingPaid: input.remainingPaid.toString(),
    walletTransaction: {
      id: tx.id,
      walletId: tx.walletId,
      type: tx.type,
      amount: tx.amount.toString(),
      state: tx.state,
      idempotencyKey: tx.idempotencyKey,
      refId: tx.refId,
      description: tx.description,
      metadata: tx.metadata,
      createdAt: tx.createdAt.toISOString(),
      updatedAt: tx.updatedAt.toISOString(),
    },
    auditId: input.auditId,
  }
}

export function parsePayInvoiceWithWalletCache(
  raw: unknown,
): PayInvoiceWithWalletCachedResponse | null {
  if (!raw || typeof raw !== 'object') return null
  const row = raw as Record<string, unknown>
  if (typeof row.invoiceId !== 'string' || typeof row.profileId !== 'string') return null
  if (typeof row.fromState !== 'string' || row.toState !== 'Paid') return null
  if (typeof row.remainingPaid !== 'string' || typeof row.auditId !== 'string') return null
  const tx = row.walletTransaction
  if (!tx || typeof tx !== 'object') return null
  const ledger = tx as Record<string, unknown>
  if (typeof ledger.id !== 'string' || typeof ledger.walletId !== 'string') return null
  if (typeof ledger.type !== 'string' || typeof ledger.amount !== 'string') return null
  if (typeof ledger.state !== 'string' || typeof ledger.idempotencyKey !== 'string') return null
  if (ledger.refId != null && typeof ledger.refId !== 'string') return null
  if (ledger.description != null && typeof ledger.description !== 'string') return null
  if (typeof ledger.createdAt !== 'string' || typeof ledger.updatedAt !== 'string') return null
  return {
    invoiceId: row.invoiceId,
    profileId: row.profileId,
    fromState: row.fromState,
    toState: 'Paid',
    remainingPaid: row.remainingPaid,
    walletTransaction: {
      id: ledger.id,
      walletId: ledger.walletId,
      type: ledger.type,
      amount: ledger.amount,
      state: ledger.state,
      idempotencyKey: ledger.idempotencyKey,
      refId: ledger.refId == null ? null : ledger.refId,
      description: ledger.description == null ? null : ledger.description,
      metadata: ledger.metadata ?? null,
      createdAt: ledger.createdAt,
      updatedAt: ledger.updatedAt,
    },
    auditId: row.auditId,
  }
}

export function cachedWalletPaymentMatchesRequest(
  cached: PayInvoiceWithWalletCachedResponse,
  invoiceId: string,
  profileId: string,
): boolean {
  return cached.invoiceId === invoiceId && cached.profileId === profileId
}
