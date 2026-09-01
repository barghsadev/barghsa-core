import type { Pool, PoolClient } from 'pg'
import { getDbPool } from '@barghsa/db'
import {
  WALLET_LEDGER_POSTED_STATE,
  WALLET_LEDGER_RESERVED_STATE,
  WALLET_MISMATCH_EXCEPTION_TYPE,
  describeWalletMismatch,
  diffWalletAgainstLedger,
  parseLedgerAmount,
  walletMismatchDetails,
  walletMismatchSeverity,
  type WalletLedgerSnapshot,
} from '@barghsa/shared/finance'

/**
 * Wallet ledger reconciliation scanner (S-04.2.01, T-04.2.01.08).
 *
 * Periodic worker pass that compares each wallet's cached
 * `posted_balance` / `reserved_balance` against the immutable ledger:
 *
 * - posted = SUM(amount) WHERE state = Completed
 * - reserved = SUM(amount) WHERE state = Reserved
 *
 * A mismatch opens a `wallet_mismatch` row on the finance reconciliation
 * queue (`reconciliation_exceptions`) so staff can investigate. The job
 * never mutates wallet or ledger rows.
 *
 * Guarantees:
 * - **Re-check under lock.** Candidates come from a set-based mismatch
 *   query, then each wallet is re-locked with `FOR UPDATE SKIP LOCKED`
 *   and the ledger sums are recomputed so an in-flight credit/debit
 *   cannot be reported as drift.
 * - **Idempotent queue.** Wallets that already have an `open` or
 *   `investigating` `wallet_mismatch` keyed by `details.walletId` are
 *   excluded from the candidate set and skipped on re-check, so a
 *   repeating tick cannot flood the finance queue.
 * - **Failure isolation.** One wallet's insert failure is recorded and
 *   skipped; the rest of the batch still runs.
 * - **Bounded drain.** A full batch (`LIMIT`) sets `truncated` so the
 *   next tick continues by `profile_id`.
 */

/** Default number of mismatched wallets claimed per tick. */
export const DEFAULT_WALLET_RECONCILIATION_BATCH_SIZE = 200

/** Default hourly cadence. */
export const DEFAULT_WALLET_RECONCILIATION_INTERVAL_MS = 60 * 60 * 1000

/** Stable worker task key recorded in `background_jobs`. */
export const WALLET_RECONCILIATION_JOB_TYPE = 'wallet_reconciliation_scan' as const

/** Outcome of one reconciliation pass. */
export interface WalletReconciliationResult {
  /** Candidate mismatched wallets fetched this tick (before lock/re-check). */
  scanned: number
  /** New finance-queue rows inserted. */
  reported: number
  /**
   * Candidates skipped because a concurrent worker held the row, the
   * wallet matched after lock, or an open/investigating exception
   * already exists.
   */
  skipped: number
  /** True when the candidate query hit the batch cap. */
  truncated: boolean
  /** Per-wallet (or unexpected) failure messages. */
  errors: string[]
}

/** Behavioural override hooks for tests. */
export interface WalletReconciliationOptions {
  pool?: Pool
  logger?: { warn: (msg: string) => void; info: (msg: string) => void }
  batchSize?: number
}

const defaultLogger = {
  warn: (msg: string): void => {
    // eslint-disable-next-line no-console
    console.warn(`[worker] ${msg}`)
  },
  info: (msg: string): void => {
    // eslint-disable-next-line no-console
    console.log(`[worker] ${msg}`)
  },
}

/**
 * Set-based mismatch selector. SUM(bigint) is numeric in PostgreSQL, so
 * both sides are cast to bigint. Already-queued wallets are excluded via
 * `details.walletId` so a repeating tick cannot starve new mismatches.
 */
export const FIND_WALLET_MISMATCH_CANDIDATES_SQL = `SELECT
          w.profile_id,
          w.posted_balance,
          w.reserved_balance,
          COALESCE(SUM(tx.amount) FILTER (WHERE tx.state = '${WALLET_LEDGER_POSTED_STATE}'), 0)::bigint
            AS ledger_posted,
          COALESCE(SUM(tx.amount) FILTER (WHERE tx.state = '${WALLET_LEDGER_RESERVED_STATE}'), 0)::bigint
            AS ledger_reserved
        FROM wallets w
        LEFT JOIN wallet_transactions tx ON tx.wallet_id = w.profile_id
        WHERE NOT EXISTS (
          SELECT 1
          FROM reconciliation_exceptions rex
          WHERE rex.exception_type = '${WALLET_MISMATCH_EXCEPTION_TYPE}'
            AND rex.status IN ('open', 'investigating')
            AND rex.details->>'walletId' = w.profile_id::text
        )
        GROUP BY w.profile_id, w.posted_balance, w.reserved_balance
        HAVING w.posted_balance
             <> COALESCE(SUM(tx.amount) FILTER (WHERE tx.state = '${WALLET_LEDGER_POSTED_STATE}'), 0)::bigint
            OR w.reserved_balance
             <> COALESCE(SUM(tx.amount) FILTER (WHERE tx.state = '${WALLET_LEDGER_RESERVED_STATE}'), 0)::bigint
        ORDER BY w.profile_id ASC
        LIMIT $1`

const LOCK_WALLET_SQL = `SELECT profile_id, posted_balance, reserved_balance
        FROM wallets
        WHERE profile_id = $1
        FOR UPDATE SKIP LOCKED`

const SUM_LEDGER_SQL = `SELECT
          COALESCE(SUM(amount) FILTER (WHERE state = '${WALLET_LEDGER_POSTED_STATE}'), 0)::bigint
            AS ledger_posted,
          COALESCE(SUM(amount) FILTER (WHERE state = '${WALLET_LEDGER_RESERVED_STATE}'), 0)::bigint
            AS ledger_reserved
        FROM wallet_transactions
        WHERE wallet_id = $1`

const FIND_OPEN_EXCEPTION_SQL = `SELECT id
        FROM reconciliation_exceptions
        WHERE exception_type = $1
          AND status IN ('open', 'investigating')
          AND details->>'walletId' = $2
        LIMIT 1`

const INSERT_EXCEPTION_SQL = `INSERT INTO reconciliation_exceptions
          (exception_type, severity, status, description, details)
        VALUES ($1, $2, 'open', $3, $4::jsonb)`

interface CandidateRow {
  profile_id: string
  posted_balance: unknown
  reserved_balance: unknown
  ledger_posted: unknown
  ledger_reserved: unknown
}

interface LockedWalletRow {
  profile_id: string
  posted_balance: unknown
  reserved_balance: unknown
}

interface LedgerSumRow {
  ledger_posted: unknown
  ledger_reserved: unknown
}

/**
 * Run one wallet ledger vs cached-balance reconciliation pass.
 */
export async function reconcileWalletBalances(
  options: WalletReconciliationOptions = {},
): Promise<WalletReconciliationResult> {
  const pool = options.pool ?? getDbPool()
  const logger = options.logger ?? defaultLogger
  const batchSize = options.batchSize ?? DEFAULT_WALLET_RECONCILIATION_BATCH_SIZE

  const result: WalletReconciliationResult = {
    scanned: 0,
    reported: 0,
    skipped: 0,
    truncated: false,
    errors: [],
  }

  const candidates = await pool.query<CandidateRow>(FIND_WALLET_MISMATCH_CANDIDATES_SQL, [
    batchSize,
  ])
  result.scanned = candidates.rows.length
  if (candidates.rows.length >= batchSize) {
    result.truncated = true
  }

  for (const candidate of candidates.rows) {
    const client = await pool.connect()
    try {
      await client.query('BEGIN')
      const reported = await reportOneMismatch(client, candidate.profile_id)
      if (reported) {
        await client.query('COMMIT')
        result.reported += 1
      } else {
        await client.query('ROLLBACK')
        result.skipped += 1
      }
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {})
      const message = `${candidate.profile_id}: ${(error as Error)?.message ?? String(error)}`
      result.errors.push(message)
      logger.warn(`Wallet reconciliation failed: ${message}`)
    } finally {
      client.release()
    }
  }

  return result
}

async function reportOneMismatch(client: PoolClient, walletId: string): Promise<boolean> {
  const locked = await client.query<LockedWalletRow>(LOCK_WALLET_SQL, [walletId])
  const wallet = locked.rows[0]
  if (!wallet) return false

  const sums = await client.query<LedgerSumRow>(SUM_LEDGER_SQL, [wallet.profile_id])
  const snapshot: WalletLedgerSnapshot = {
    walletId: wallet.profile_id,
    postedBalance: parseLedgerAmount(wallet.posted_balance),
    reservedBalance: parseLedgerAmount(wallet.reserved_balance),
    ledgerPostedSum: parseLedgerAmount(sums.rows[0]?.ledger_posted),
    ledgerReservedSum: parseLedgerAmount(sums.rows[0]?.ledger_reserved),
  }
  const mismatch = diffWalletAgainstLedger(snapshot)
  if (mismatch === null) return false

  const existing = await client.query<{ id: string }>(FIND_OPEN_EXCEPTION_SQL, [
    WALLET_MISMATCH_EXCEPTION_TYPE,
    wallet.profile_id,
  ])
  if (existing.rows[0]) return false

  await client.query(INSERT_EXCEPTION_SQL, [
    WALLET_MISMATCH_EXCEPTION_TYPE,
    walletMismatchSeverity(mismatch),
    describeWalletMismatch(mismatch),
    JSON.stringify(walletMismatchDetails(mismatch)),
  ])
  return true
}
