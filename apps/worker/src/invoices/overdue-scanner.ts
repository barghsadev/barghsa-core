import { randomUUID } from 'node:crypto'
import type { Pool, PoolClient } from 'pg'
import { getDbPool } from '@barghsa/db'
import {
  MARK_OVERDUE_AUDIT_EVENT,
  MARK_OVERDUE_REASON,
  MARK_OVERDUE_TRANSITION,
  OVERDUE_ELIGIBLE_STATES,
  isEligibleForOverdueMark,
} from '@barghsa/shared/finance'

/**
 * Invoice overdue scanner (S-04.1.03, T-04.1.03.04).
 *
 * Periodic worker pass that marks invoices whose `due_at` is strictly in
 * the past and whose stored state is still `Unpaid` or `PartiallyFunded`
 * as `Overdue`. Side effects match the S-04.1.01 MarkOverdue transition:
 *
 * - `state` → `Overdue`
 * - `overdue_at` stamped with the scan clock
 * - one append-only `invoice.mark_overdue` audit row in the same
 *   transaction (actor, previous/new state, reason, correlation id)
 *
 * There is no automatic late fee or service suspension in v1. Reminders
 * continue from the later S-04.1.04 schedule; this job only flips state.
 *
 * Guarantees:
 * - **Eligibility re-check under lock.** A candidate is selected, then
 *   re-locked with `FOR UPDATE SKIP LOCKED` and re-validated so a concurrent
 *   payment, cancel, staff dueAt override, or sibling worker cannot be
 *   overwritten.
 * - **Idempotent.** Already-Overdue (and every other non-eligible state)
 *   never matches the candidate predicate, so a re-run is a no-op.
 * - **Failure isolation.** One invoice's transition failure is recorded
 *   and skipped; the rest of the batch still runs.
 * - **Bounded drain.** A full batch (`LIMIT`) sets `truncated` so the
 *   next tick continues oldest-due first.
 *
 * The audit `user_id` FK requires a real `users` row. Tests inject
 * `actorUserId`. Production resolves `WORKER_SYSTEM_ACTOR_USER_ID` when
 * that user exists, otherwise the oldest platform admin. A scan with no
 * resolvable actor marks nothing and reports an error (the job recorder
 * surfaces it on the failed-jobs dashboard).
 */

/** Default number of past-due invoices claimed per tick. */
export const DEFAULT_OVERDUE_BATCH_SIZE = 200

/** Stable worker task key recorded in `background_jobs`. */
export const INVOICE_OVERDUE_JOB_TYPE = 'invoice_overdue_scan' as const

/** Outcome of one overdue scan. */
export interface OverdueScanResult {
  /** Candidate rows fetched this tick (before per-row lock/re-check). */
  scanned: number
  /** Invoices successfully moved to Overdue. */
  marked: number
  /**
   * Candidates skipped because a concurrent worker held the row, the
   * invoice was no longer eligible after lock, or the lock returned nothing.
   */
  skipped: number
  /** True when the candidate query hit the batch cap. */
  truncated: boolean
  /** Per-invoice (or actor-resolution) failure messages. */
  errors: string[]
}

/** Behavioural override hooks for tests. */
export interface OverdueScanOptions {
  pool?: Pool
  now?: () => Date
  logger?: { warn: (msg: string) => void; info: (msg: string) => void }
  batchSize?: number
  /**
   * Audit actor. When set, the users lookup is skipped (unit tests).
   * Production leaves this unset so the worker resolves a real user.
   */
  actorUserId?: string
  /** Correlation id shared by every mark in this tick. */
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
 * Candidate selector. `invoices.state` is PostgreSQL type `invoice_state`;
 * comparing it to `$1::text[]` has no operator and fails on every scan.
 * Cast the bound array to `invoice_state[]` so the predicate is valid and
 * can use `idx_invoices_state`.
 */
export const FIND_OVERDUE_CANDIDATES_SQL = `SELECT id, state, due_at
        FROM invoices
        WHERE state = ANY($1::invoice_state[])
          AND due_at IS NOT NULL
          AND due_at < $2
        ORDER BY due_at ASC, id ASC
        LIMIT $3`

const LOCK_INVOICE_SQL = `SELECT id, state, due_at
        FROM invoices
        WHERE id = $1
        FOR UPDATE SKIP LOCKED`

const UPDATE_OVERDUE_SQL = `UPDATE invoices
        SET state = 'Overdue',
            overdue_at = $2,
            updated_at = NOW()
        WHERE id = $1
          AND state = $3::invoice_state`

const INSERT_AUDIT_SQL = `INSERT INTO audit_log (id, user_id, event, metadata, correlation_id, ip, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`

const LOOKUP_USER_SQL = `SELECT user_id FROM users WHERE user_id = $1 LIMIT 1`

const LOOKUP_ADMIN_SQL = `SELECT user_id FROM users
        WHERE is_admin = TRUE
        ORDER BY created_at ASC
        LIMIT 1`

interface CandidateRow {
  id: string
  state: string
  due_at: Date | string | null
}

/**
 * Resolve the audit actor for a system-initiated MarkOverdue.
 *
 * Preference: explicit option (tests) → `WORKER_SYSTEM_ACTOR_USER_ID` when
 * that user exists → oldest platform admin. Null means the scan must abort.
 */
export async function resolveOverdueActor(
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
 * Run one overdue-marking pass.
 */
export async function scanOverdueInvoices(
  options: OverdueScanOptions = {},
): Promise<OverdueScanResult> {
  const pool = options.pool ?? getDbPool()
  const now = options.now?.() ?? new Date()
  const logger = options.logger ?? defaultLogger
  const batchSize = options.batchSize ?? DEFAULT_OVERDUE_BATCH_SIZE
  const newId = options.newId ?? randomUUID
  const correlationId = options.correlationId ?? newId()

  const result: OverdueScanResult = {
    scanned: 0,
    marked: 0,
    skipped: 0,
    truncated: false,
    errors: [],
  }

  const actorUserId = await resolveOverdueActor(pool, options.actorUserId)
  if (actorUserId === null) {
    const message =
      'invoice overdue scan aborted: no system actor (set WORKER_SYSTEM_ACTOR_USER_ID or create a platform admin)'
    result.errors.push(message)
    logger.warn(message)
    return result
  }

  const candidates = await pool.query<CandidateRow>(FIND_OVERDUE_CANDIDATES_SQL, [
    [...OVERDUE_ELIGIBLE_STATES],
    now,
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
      const marked = await markOneOverdue(client, {
        invoiceId: candidate.id,
        actorUserId,
        now,
        correlationId,
        newId,
      })
      if (marked) {
        await client.query('COMMIT')
        result.marked += 1
      } else {
        await client.query('ROLLBACK')
        result.skipped += 1
      }
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {})
      const message = `${candidate.id}: ${(error as Error)?.message ?? String(error)}`
      result.errors.push(message)
      logger.warn(`Overdue mark failed: ${message}`)
    } finally {
      client.release()
    }
  }

  return result
}

async function markOneOverdue(
  client: PoolClient,
  input: {
    invoiceId: string
    actorUserId: string
    now: Date
    correlationId: string
    newId: () => string
  },
): Promise<boolean> {
  const locked = await client.query<CandidateRow>(LOCK_INVOICE_SQL, [input.invoiceId])
  const row = locked.rows[0]
  if (!row) return false
  if (!isEligibleForOverdueMark(row.state, row.due_at, input.now)) return false

  const updated = await client.query(UPDATE_OVERDUE_SQL, [
    row.id,
    input.now,
    row.state,
  ])
  if ((updated.rowCount ?? 0) !== 1) return false

  const metadata = JSON.stringify({
    invoiceId: row.id,
    fromState: row.state,
    toState: 'Overdue',
    transition: MARK_OVERDUE_TRANSITION,
    reason: MARK_OVERDUE_REASON,
  })

  await client.query(INSERT_AUDIT_SQL, [
    input.newId(),
    input.actorUserId,
    MARK_OVERDUE_AUDIT_EVENT,
    metadata,
    input.correlationId,
    null,
    input.now,
  ])

  return true
}
