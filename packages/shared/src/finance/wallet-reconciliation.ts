/**
 * Wallet ledger vs cached-balance reconciliation contract
 * (T-04.2.01.08 / S-04.2.01).
 *
 * Canonical rule: the cached wallet row must equal the immutable ledger.
 *
 * - `postedBalance` = SUM of `wallet_transactions.amount` in state
 *   `Completed` (credits positive, debits negative).
 * - `reservedBalance` = SUM of `wallet_transactions.amount` in state
 *   `Reserved` (live holds only; Released rows do not count).
 *
 * Pending / Failed / Rejected / Reversed rows never contribute. A
 * scheduled worker compares the two sides and, on drift, opens a
 * `wallet_mismatch` item on the finance reconciliation queue.
 *
 * @module finance
 */

/** Ledger state that posts into `wallets.posted_balance`. */
export const WALLET_LEDGER_POSTED_STATE = 'Completed' as const

/** Ledger state that posts into `wallets.reserved_balance`. */
export const WALLET_LEDGER_RESERVED_STATE = 'Reserved' as const

/** Reconciliation exception type written to the finance queue. */
export const WALLET_MISMATCH_EXCEPTION_TYPE = 'wallet_mismatch' as const

/** Producer key stored on exception `details.source`. */
export const WALLET_RECONCILIATION_SOURCE = 'wallet_reconciliation_scan' as const

/**
 * Absolute posted or reserved drift (IRR) at or above which a mismatch
 * is triaged `critical`. Below this, every mismatch is `high` — any
 * ledger/cache disagreement is a finance incident.
 */
export const WALLET_MISMATCH_CRITICAL_ABS_IRR = 1_000_000_000n

/** Snapshot used to compare one wallet row against its ledger sums. */
export interface WalletLedgerSnapshot {
  walletId: string
  postedBalance: bigint
  reservedBalance: bigint
  ledgerPostedSum: bigint
  ledgerReservedSum: bigint
}

/** A wallet whose cached balances disagree with the ledger. */
export interface WalletMismatch extends WalletLedgerSnapshot {
  /** `postedBalance - ledgerPostedSum` (wallet minus ledger). */
  postedDelta: bigint
  /** `reservedBalance - ledgerReservedSum` (wallet minus ledger). */
  reservedDelta: bigint
}

/** Severity written onto a `wallet_mismatch` finance-queue row. */
export type WalletMismatchSeverity = 'high' | 'critical'

function absDelta(value: bigint): bigint {
  return value < 0n ? -value : value
}

/**
 * Compare cached wallet balances to the ledger sums. Returns `null`
 * when both sides agree.
 */
export function diffWalletAgainstLedger(
  snapshot: WalletLedgerSnapshot,
): WalletMismatch | null {
  const postedDelta = snapshot.postedBalance - snapshot.ledgerPostedSum
  const reservedDelta = snapshot.reservedBalance - snapshot.ledgerReservedSum
  if (postedDelta === 0n && reservedDelta === 0n) return null
  return { ...snapshot, postedDelta, reservedDelta }
}

/** True when cached posted/reserved balances equal the ledger sums. */
export function walletMatchesLedger(snapshot: WalletLedgerSnapshot): boolean {
  return diffWalletAgainstLedger(snapshot) === null
}

/**
 * Triage severity for a mismatch. Any drift is at least `high`;
 * `|postedDelta|` or `|reservedDelta|` at or above
 * {@link WALLET_MISMATCH_CRITICAL_ABS_IRR} is `critical`.
 */
export function walletMismatchSeverity(mismatch: WalletMismatch): WalletMismatchSeverity {
  const magnitude =
    absDelta(mismatch.postedDelta) > absDelta(mismatch.reservedDelta)
      ? absDelta(mismatch.postedDelta)
      : absDelta(mismatch.reservedDelta)
  return magnitude >= WALLET_MISMATCH_CRITICAL_ABS_IRR ? 'critical' : 'high'
}

/** Human-readable finance-queue summary for a mismatch. */
export function describeWalletMismatch(mismatch: WalletMismatch): string {
  return (
    `Wallet ledger mismatch for ${mismatch.walletId}: ` +
    `posted wallet=${mismatch.postedBalance.toString()} ` +
    `ledger=${mismatch.ledgerPostedSum.toString()} ` +
    `(delta=${mismatch.postedDelta.toString()}); ` +
    `reserved wallet=${mismatch.reservedBalance.toString()} ` +
    `ledger=${mismatch.ledgerReservedSum.toString()} ` +
    `(delta=${mismatch.reservedDelta.toString()})`
  )
}

/** JSONB audit payload stored on the finance-queue row. */
export function walletMismatchDetails(mismatch: WalletMismatch): Record<string, string> {
  return {
    walletId: mismatch.walletId,
    postedBalance: mismatch.postedBalance.toString(),
    reservedBalance: mismatch.reservedBalance.toString(),
    ledgerPostedSum: mismatch.ledgerPostedSum.toString(),
    ledgerReservedSum: mismatch.ledgerReservedSum.toString(),
    postedDelta: mismatch.postedDelta.toString(),
    reservedDelta: mismatch.reservedDelta.toString(),
    source: WALLET_RECONCILIATION_SOURCE,
  }
}

/**
 * Parse a pg bigint / numeric SUM into `bigint`. Integer strings,
 * whole numbers, and `123.0` numerics are accepted; anything else is 0n
 * so a corrupt driver value cannot throw mid-scan.
 */
export function parseLedgerAmount(value: unknown): bigint {
  if (typeof value === 'bigint') return value
  if (typeof value === 'number' && Number.isInteger(value)) return BigInt(value)
  if (typeof value === 'string') {
    const trimmed = value.trim()
    if (/^-?\d+$/.test(trimmed)) return BigInt(trimmed)
    const whole = trimmed.match(/^(-?\d+)\.0+$/)
    if (whole?.[1]) return BigInt(whole[1])
  }
  return 0n
}
