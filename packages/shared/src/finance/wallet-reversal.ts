/**
 * Wallet ledger reversal helpers (T-04.2.04.01 / S-04.2.04).
 *
 * A chargeback or reversed provider payment must never rewrite the
 * original ledger row. The original stays `Completed` so
 * `postedBalance = SUM(Completed amounts)` still holds; a new
 * `reversal` row posts the opposite signed amount and the wallet cache
 * is adjusted by that same delta.
 *
 * `reverses_transaction_id` (unique when present) is the last-line
 * guard that one original can be reversed at most once. Client
 * `idempotencyKey` is the retry guard.
 *
 * @module finance
 */

/** Ledger type written by `WalletService.reverseTransaction`. */
export const WALLET_REVERSAL_TYPE = 'reversal' as const

/** Reversal rows post into `wallets.posted_balance`. */
export const WALLET_REVERSAL_POSTED_STATE = 'Completed' as const

/**
 * Posted money-moving types that may be reversed. Reservations and
 * releases do not post; a reversal of a reversal is refused so the
 * compensating row stays the terminal correction.
 */
export const REVERSIBLE_WALLET_LEDGER_TYPES = [
  'topup',
  'payment',
  'refund',
  'compensating',
] as const

export type ReversibleWalletLedgerType =
  (typeof REVERSIBLE_WALLET_LEDGER_TYPES)[number]

/** Only Completed rows have already moved `posted_balance`. */
export const REVERSIBLE_WALLET_LEDGER_STATE = 'Completed' as const

/** Unique partial index on `wallet_transactions.reverses_transaction_id`. */
export const WALLET_TX_REVERSES_CONSTRAINT = 'uq_wallet_tx_reverses_transaction'

export const WALLET_REVERSAL_ERRORS = {
  ORIGINAL_ID_REQUIRED: () => 'Original transaction id must be a UUID',
  REASON_REQUIRED: () => 'Reversal reason is required',
  IDEMPOTENCY_REQUIRED: () => 'Idempotency key is required',
  NOT_FOUND: (id: string) => `Wallet transaction not found: ${id}`,
  NOT_REVERSIBLE_TYPE: (type: string) =>
    `Ledger type '${type}' cannot be reversed`,
  NOT_REVERSIBLE_STATE: (state: string) =>
    `Ledger row in state '${state}' cannot be reversed`,
  ALREADY_REVERSED: (id: string) =>
    `Wallet transaction ${id} has already been reversed`,
  INSUFFICIENT_BALANCE: (available: bigint, required: bigint) =>
    `Insufficient balance: available=${available.toString()}, required=${required.toString()}`,
  IDEMPOTENCY_COLLISION: () =>
    'Idempotency key already used for a different wallet operation',
  IDEMPOTENCY_WALLET: () =>
    'Idempotency key already used for a different wallet',
} as const

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export function isWalletTransactionUuid(value: string): boolean {
  return UUID_RE.test(value.trim())
}

export function isReversibleWalletLedgerType(
  type: string,
): type is ReversibleWalletLedgerType {
  return (REVERSIBLE_WALLET_LEDGER_TYPES as readonly string[]).includes(type)
}

export function isReversibleWalletLedgerState(state: string): boolean {
  return state === REVERSIBLE_WALLET_LEDGER_STATE
}

/**
 * Signed amount posted by the compensating reversal row: the opposite
 * of the original. Original credits (positive) reverse as debits.
 */
export function reversalAmount(originalAmount: bigint): bigint {
  return -originalAmount
}

/** True when reversing a credit: posted_balance must fall. */
export function reversalDebitsPostedBalance(originalAmount: bigint): boolean {
  return originalAmount > 0n
}

/**
 * Absolute IRR that must be available when the reversal debits posted
 * balance. Zero when the reversal is a credit (undoing a payment).
 */
export function availableRequiredForReversal(originalAmount: bigint): bigint {
  return originalAmount > 0n ? originalAmount : 0n
}

export function availableCoversReversal(
  availableBalance: bigint,
  originalAmount: bigint,
): boolean {
  return availableBalance >= availableRequiredForReversal(originalAmount)
}

export interface WalletReversalMetadata {
  originalTransactionId: string
  originalType: string
  originalAmount: string
  originalRefId: string | null
  reason: string
}

export function walletReversalMetadata(input: {
  originalTransactionId: string
  originalType: string
  originalAmount: bigint
  originalRefId?: string | null
  reason: string
}): WalletReversalMetadata {
  return {
    originalTransactionId: input.originalTransactionId,
    originalType: input.originalType,
    originalAmount: input.originalAmount.toString(),
    originalRefId: input.originalRefId ?? null,
    reason: input.reason,
  }
}

export interface WalletReversalReplayRow {
  walletId: string
  type: string
  amount: bigint
  state: string
  reversesTransactionId: string | null
  description: string | null
}

/**
 * Idempotent reversal replay is only valid for the same Completed
 * reversal of the same original: same wallet, type, opposite amount,
 * `reverses_transaction_id`, and reason.
 */
export function isMatchingReversalReplay(
  existing: WalletReversalReplayRow,
  expected: {
    walletId: string
    originalTransactionId: string
    originalAmount: bigint
    reason: string
  },
): boolean {
  return (
    existing.walletId === expected.walletId &&
    existing.state === WALLET_REVERSAL_POSTED_STATE &&
    existing.type === WALLET_REVERSAL_TYPE &&
    existing.amount === reversalAmount(expected.originalAmount) &&
    existing.reversesTransactionId === expected.originalTransactionId &&
    existing.description === expected.reason
  )
}
