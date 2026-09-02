import { randomUUID } from 'node:crypto'
import type { Pool, PoolClient } from 'pg'
import { getDbPool } from '@barghsa/db'
import {
  ONLINE_TOPUP_CHANNEL,
  ONLINE_TOPUP_EXPIRED_STATE,
  ONLINE_TOPUP_EXPIRY_AUDIT_EVENT,
  ONLINE_TOPUP_EXPIRY_REASON,
  ONLINE_TOPUP_EXPIRY_TRANSITION,
  isEligibleForOnlineTopUpExpiry,
  onlineTopUpExpiryCutoff,
  parseOnlineTopUpPendingTtlMs,
  readOnlineTopUpChannel,
} from '@barghsa/shared/finance'

/**
 * Online top-up Pending TTL expiry scanner (S-04.2.02, T-04.2.02.07).
 *
 * Periodic worker pass that auto-rejects online `topup` ledger rows still
 * in `Pending` after the configured TTL. Pending intents never change
 * wallet balances, so rejection is a state + metadata stamp only:
 *
 * - `state` → `Rejected`
 * - `metadata.expiry` records reason, TTL, and clock (provider authority
 *   on `metadata.gateway` is preserved for later callback reconciliation)
 * - one append-only `wallet.online_topup.expired` audit row in the same
 *   transaction (actor, previous/new state, reason, correlation id)
 *
 * Bank-receipt Pendings are excluded (`metadata.channel = 'online'` only).
 *
 * Guarantees:
 * - **Eligibility re-check under lock.** A candidate is selected, then
 *   re-locked with `FOR UPDATE SKIP LOCKED` and re-validated so a
 *   concurrent provider callback cannot be overwritten.
 * - **Idempotent.** Already-Rejected (and every other non-Pending) rows
 *   never match the candidate predicate, so a re-run is a no-op.
 * - **Failure isolation.** One row's update failure is recorded and
 *   skipped; the rest of the batch still runs.
 * - **Bounded drain.** A full batch (`LIMIT`) sets `truncated` so the
 *   next tick continues oldest-created first.
 *
 * The audit `user_id` FK requires a real `users` row. Tests inject
 * `actorUserId`. Production resolves `WORKER_SYSTEM_ACTOR_USER_ID` when
 * that user exists, otherwise the oldest platform admin. A scan with no
 * resolvable actor marks nothing and reports an error (the job recorder
 * surfaces it on the failed-jobs dashboard).
 */

/** Default number of expired online top-ups claimed per tick. */
export const DEFAULT_ONLINE_TOPUP_EXPIRY_BATCH_SIZE = 200

/** Default one-minute cadence. */
export const DEFAULT_ONLINE_TOPUP_EXPIRY_INTERVAL_MS = 60 * 1000

/** Stable worker task key recorded in `background_jobs`. */
export const ONLINE_TOPUP_EXPIRY_JOB_TYPE = 'online_topup_expiry_scan' as const

/** Outcome of one expiry scan. */
export interface OnlineTopUpExpiryResult {
  /** Candidate rows fetched this tick (before per-row lock/re-check). */
  scanned: number
  /** Online top-ups successfully moved to Rejected. */
  rejected: number
  /**
   * Candidates skipped because a concurrent worker held the row, the
   * intent was no longer eligible after lock, or the lock returned nothing.
   */
  skipped: number
  /** True when the candidate query hit the batch cap. */
  truncated: boolean
  /** Per-row (or actor-resolution) failure messages. */
  errors: string[]
}

/** Behavioural override hooks for tests. */
export interface OnlineTopUpExpiryOptions {
  pool?: Pool
  now?: () => Date
  logger?: { warn: (msg: string) => void; info: (msg: string) => void }
  batchSize?: number
  ttlMs?: number
  /**
   * Audit actor. When set, the users lookup is skipped (unit tests).
   * Production leaves this unset so the worker resolves a real user.
   */
  actorUserId?: string
  /** Correlation id shared by every expiry in this tick. */
  correlationId?: string
  /** Audit row id factory (uuid v4 by default). */
  newId?: () => string
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
 * Candidate selector. `wallet_transactions.state`/`type` are TEXT with
 * CHECKs (not enums), so bound text comparisons are valid. Channel is
 * the online discriminator from initiation metadata.
 */
export const FIND_EXPIRED_ONLINE_TOPUP_CANDIDATES_SQL = `SELECT id, wallet_id, type, state, created_at, metadata
        FROM wallet_transactions
        WHERE type = 'topup'
          AND state = 'Pending'
          AND metadata->>'channel' = $1
          AND created_at < $2
        ORDER BY created_at ASC, id ASC
        LIMIT $3`

const LOCK_TOPUP_SQL = `SELECT id, wallet_id, type, state, created_at, metadata
        FROM wallet_transactions
        WHERE id = $1
        FOR UPDATE SKIP LOCKED`

const REJECT_EXPIRED_SQL = `UPDATE wallet_transactions
        SET state = '${ONLINE_TOPUP_EXPIRED_STATE}',
            metadata = COALESCE(metadata, '{}'::jsonb) || $2::jsonb
        WHERE id = $1
          AND type = 'topup'
          AND state = 'Pending'`

const INSERT_AUDIT_SQL = `INSERT INTO audit_log (id, user_id, event, metadata, correlation_id, ip, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`

const LOOKUP_USER_SQL = `SELECT user_id FROM users WHERE user_id = $1 LIMIT 1`

const LOOKUP_ADMIN_SQL = `SELECT user_id FROM users
        WHERE is_admin = TRUE
        ORDER BY created_at ASC
        LIMIT 1`

interface CandidateRow {
  id: string
  wallet_id: string
  type: string
  state: string
  created_at: Date | string
  metadata: unknown
}

/**
 * Resolve the audit actor for a system-initiated online top-up expiry.
 *
 * Preference: explicit option (tests) → `WORKER_SYSTEM_ACTOR_USER_ID` when
 * that user exists → oldest platform admin. Null means the scan must abort.
 */
export async function resolveOnlineTopUpExpiryActor(
  pool: Pool,
  explicit?: string,
): Promise<string | null> {
  if (typeof explicit === 'string' && explicit.trim() !== '') {
    return explicit
  }
  const envId = process.env['WORKER_SYSTEM_ACTOR_USER_ID']
  if (typeof envId === 'string' && envId.trim() !== '') {
    const found = await pool.query<{ user_id: string }>(LOOKUP_USER_SQL, [envId.trim()])
    if (found.rows[0]) return found.rows[0].user_id
  }
  const admin = await pool.query<{ user_id: string }>(LOOKUP_ADMIN_SQL)
  return admin.rows[0]?.user_id ?? null
}

/**
 * Run one online top-up TTL expiry pass.
 */
export async function expireStaleOnlineTopUps(
  options: OnlineTopUpExpiryOptions = {},
): Promise<OnlineTopUpExpiryResult> {
  const pool = options.pool ?? getDbPool()
  const now = options.now?.() ?? new Date()
  const logger = options.logger ?? defaultLogger
  const batchSize = options.batchSize ?? DEFAULT_ONLINE_TOPUP_EXPIRY_BATCH_SIZE
  const ttlMs = options.ttlMs ?? parseOnlineTopUpPendingTtlMs(process.env['ONLINE_TOPUP_PENDING_TTL_MS'])
  const cutoff = onlineTopUpExpiryCutoff(now, ttlMs)
  const newId = options.newId ?? randomUUID
  const correlationId = options.correlationId ?? newId()

  const result: OnlineTopUpExpiryResult = {
    scanned: 0,
    rejected: 0,
    skipped: 0,
    truncated: false,
    errors: [],
  }

  const actorUserId = await resolveOnlineTopUpExpiryActor(pool, options.actorUserId)
  if (actorUserId === null) {
    const message =
      'online top-up expiry aborted: no system actor (set WORKER_SYSTEM_ACTOR_USER_ID or create a platform admin)'
    result.errors.push(message)
    logger.warn(message)
    return result
  }

  const candidates = await pool.query<CandidateRow>(FIND_EXPIRED_ONLINE_TOPUP_CANDIDATES_SQL, [
    ONLINE_TOPUP_CHANNEL,
    cutoff,
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
      const rejected = await rejectOneExpired(client, {
        transactionId: candidate.id,
        actorUserId,
        now,
        ttlMs,
        correlationId,
        newId,
      })
      if (rejected) {
        await client.query('COMMIT')
        result.rejected += 1
      } else {
        await client.query('ROLLBACK')
        result.skipped += 1
      }
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {})
      const message = `${candidate.id}: ${(error as Error)?.message ?? String(error)}`
      result.errors.push(message)
      logger.warn(`Online top-up expiry failed: ${message}`)
    } finally {
      client.release()
    }
  }

  return result
}

async function rejectOneExpired(
  client: PoolClient,
  input: {
    transactionId: string
    actorUserId: string
    now: Date
    ttlMs: number
    correlationId: string
    newId: () => string
  },
): Promise<boolean> {
  const locked = await client.query<CandidateRow>(LOCK_TOPUP_SQL, [input.transactionId])
  const row = locked.rows[0]
  if (!row) return false
  if (
    !isEligibleForOnlineTopUpExpiry(
      {
        type: row.type,
        state: row.state,
        channel: readOnlineTopUpChannel(row.metadata),
        createdAt: row.created_at,
      },
      input.now,
      input.ttlMs,
    )
  ) {
    return false
  }

  const updated = await client.query(REJECT_EXPIRED_SQL, [
    row.id,
    JSON.stringify({
      expiry: {
        rejectedAt: input.now.toISOString(),
        reason: ONLINE_TOPUP_EXPIRY_REASON,
        ttlMs: input.ttlMs,
      },
    }),
  ])
  if ((updated.rowCount ?? 0) !== 1) return false

  const metadata = JSON.stringify({
    transactionId: row.id,
    walletId: row.wallet_id,
    fromState: row.state,
    toState: ONLINE_TOPUP_EXPIRED_STATE,
    transition: ONLINE_TOPUP_EXPIRY_TRANSITION,
    reason: ONLINE_TOPUP_EXPIRY_REASON,
    ttlMs: input.ttlMs,
  })

  await client.query(INSERT_AUDIT_SQL, [
    input.newId(),
    input.actorUserId,
    ONLINE_TOPUP_EXPIRY_AUDIT_EVENT,
    metadata,
    input.correlationId,
    null,
    input.now,
  ])

  return true
}
