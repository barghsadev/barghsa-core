import { getDbPool } from '@barghsa/db'
import type { INotificationTransport, NotificationChannel } from '@barghsa/shared/notifications'
import { leaseOutbox, dispatchOutbox, type OutboxRow, type OutboxReaderOptions } from './outbox-reader.js'
import { nextRetryDelayMs } from './retry-schedule.js'
import { writeDeliveryLog, classifyDeliveryError } from './delivery-log.js'
import { writeDeadLetter } from './dead-letter.js'
import { sanitizeError } from './error-redact.js'

/**
 * Outbox dispatch runner (E-05, T-05.01.02 / T-05.01.03).
 *
 * Ties the durable write pipeline together on the consuming side:
 * each poll leases due outbox rows (`leaseOutbox`), marks them `sending`,
 * dispatches every requested channel through the registered transports
 * (`dispatchOutbox`), then records the outcome on each per-channel
 * `notification_job` row and the aggregate outcome on the outbox row.
 *
 * Lifecycle handled here:
 *   queued/scheduled → sending (leased) → delivered | dead_letter | retrying
 *
 * - A retry-eligible row (attempts < maxAttempts) is returned to `queued` with
 *   a `locked_until` back-off drawn from the T-05.01.03 retry ladder
 *   (1min → 5min → 30min → 2hr) with ±20% jitter, so it is not re-leased on
 *   the very next poll tick.
 * - A row whose attempts reach `max_attempts` is marked `failed` permanently
 *   and its per-channel jobs move to `dead_letter` for review / retry / resolve.
 * - `max_attempts` is configurable per notification type (see retry-schedule).
 * - `last_error` is sanitized before persistence so provider messages can
 *   never leak credentials or connection strings.
 */
export interface OutboxRunResult {
  /** Number of outbox rows claimed in this poll. */
  leased: number
  /** Number of rows whose channels all delivered. */
  delivered: number
  /** Number of rows that failed (or are retrying) at least one channel. */
  failed: number
}

/** How long a dispatched-but-unconfirmed row stays `sending` before re-claim. */
const SENDING_LEASE_MS = 30_000

/**
 * Redact + cap a persisted error. Kept as an alias of the shared sanitizer so
 * existing callers (and tests) importing `sanitizeLastError` from this module
 * keep working. See `./error-redact.ts`.
 */
export const sanitizeLastError = sanitizeError

export async function runOutboxPoll(
  options?: OutboxReaderOptions & {
    /** Override the pool for tests. */
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    pool?: any
  },
): Promise<OutboxRunResult> {
  const pool = options?.pool ?? getDbPool()
  const rows = await leaseOutbox(options)

  const result: OutboxRunResult = { leased: rows.length, delivered: 0, failed: 0 }
  if (rows.length === 0) return result

  for (const row of rows) {
    // Mark the row as in-flight so it isn't re-claimed mid-dispatch while leased.
    await pool.query(
      `UPDATE notification_outbox
          SET status = 'sending', locked_until = $2, updated_at = NOW()
        WHERE id = $1`,
      [row.id, new Date(Date.now() + SENDING_LEASE_MS)],
    )

    try {
      const outcomes = await dispatchOutbox(row, options?.transports ?? {})
      await persistOutcomes(pool, row, outcomes)
      // A row is "delivered" only when every requested channel delivered.
      const anyFailed = outcomes.some((o) => o.result.status === 'failed')
      if (anyFailed) {
        result.failed += 1
      } else {
        result.delivered += 1
      }
    } catch (err) {
      const message = sanitizeLastError(err instanceof Error ? err.message : String(err))
      await failRow(pool, row, message)
      // dispatchOutbox threw before any per-channel outcome was recorded, so
      // mark every requested job consistently with the outbox row (retrying or
      // failed once attempts are exhausted).
      await failAllJobs(pool, row, message)
      result.failed += 1
    }
  }

  return result
}

interface DispatchOutcome {
  channel: NotificationChannel
  result: { providerRef: string; status: 'delivered' | 'failed' }
  /** Provider round-trip latency in milliseconds for this attempt. */
  latencyMs: number
}

/**
 * Run `work` inside a transaction when `pool` is a real `pg.Pool` (which
 * supports `connect()`); otherwise fall back to running the queries directly
 * against the (test) pool. Returns a bound query function and a `finish`
 * token — use `q(...)` for every statement so the whole per-row persistence is
 * atomic in production, while the fake test pool keeps working unchanged.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function withWorkerTx(pool: any): Promise<{
  q: (sql: string, params?: unknown[]) => Promise<any>
  commit: () => Promise<void>
  rollback: () => Promise<void>
  release: () => void
}> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const client = typeof pool.connect === 'function' ? await pool.connect() : null
  if (client) {
    await client.query('BEGIN')
    return {
      q: (sql, params) => client.query(sql, params),
      commit: () => client.query('COMMIT'),
      rollback: () => client.query('ROLLBACK'),
      release: () => client.release(),
    }
  }
  return {
    q: (sql, params) => pool.query(sql, params),
    commit: async () => undefined,
    rollback: async () => undefined,
    release: () => undefined,
  }
}

/**
 * Persist per-channel outcomes to each notification_job and derive the
 * outbox row's aggregate state. A successfully delivered job stores the real
 * provider ref returned by the transport (no synthetic values). A failed job
 * is returned to `retrying` with a T-05.01.03 backoff `run_after`, or moved
 * to `dead_letter` once its per-type attempt budget is exhausted.
 */
async function persistOutcomes(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  pool: any,
  row: OutboxRow,
  outcomes: DispatchOutcome[],
): Promise<void> {
  // All per-row persistence (job status, dead-letter, delivery log, outbox
  // state) is committed atomically on a pinned client in production.
  const tx = await withWorkerTx(pool)
  const q = tx.q
  // Minimal pool-like surface so the shared writers route through the tx.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const qpool = { query: q } as any
  try {
    let anyFailed = false
    const attempts = row.attempts + 1
    for (const outcome of outcomes) {
      const ok = outcome.result.status === 'delivered'
      if (!ok) anyFailed = true
      const exhausted = attempts >= row.maxAttempts
      // Jittered backoff before the next attempt (null when the budget is spent).
      const runAfterMs = exhausted ? null : nextRetryDelayMs(attempts, row.maxAttempts)
      const runAfter = runAfterMs === null ? null : new Date(Date.now() + runAfterMs)
      const jobUpdate = await q(
        `UPDATE notification_job
            SET status = $2, provider_ref = $3, attempts = $4, last_error = $5,
                run_after = $7, updated_at = NOW()
          WHERE outbox_id = $1 AND channel = $6
          RETURNING id`,
        [
          row.id,
          ok ? 'done' : exhausted ? 'dead_letter' : 'retrying',
          ok ? outcome.result.providerRef : null,
          attempts,
          ok ? null : 'delivery failed',
          outcome.channel,
          runAfter,
        ],
      )
      // A job that exhausted its retry budget is copied to the dead-letter queue
      // (T-05.01.06) so the admin panel can triage it (Retry / Resolve / Dismiss).
      // Same transaction as the job status update, so a crash cannot leave a
      // 'dead_letter' job with no dead-letter row.
      if (!ok && exhausted) {
        const jobId = (jobUpdate.rows as Array<{ id: string }>)[0]?.id
        if (jobId) {
          // Prefer the outbox row's last sanitized error (set by failRow on a
          // prior attempt) for triage; fall back to a generic description when
          // the transport reported failure without an error message.
          const cause = row.lastError ?? 'delivery failed'
          await writeDeadLetter(qpool, {
            outboxId: row.id,
            jobId,
            channel: outcome.channel,
            eventKey: row.eventKey,
            profileId: row.profileId,
            userId: row.userId,
            attempts,
            maxAttempts: row.maxAttempts,
            idempotencyKey: row.idempotencyKey,
            cause,
            errorCategory: classifyDeliveryError(cause),
          })
        }
      }
      // Append a delivery log row for this attempt (T-05.01.05). The suspected
      // cause is derived from the sanitized provider message when available.
      await writeDeliveryLog(qpool, {
        notificationId: row.id,
        channel: outcome.channel,
        delivered: ok,
        attemptNumber: attempts,
        providerRef: ok ? outcome.result.providerRef : null,
        latencyMs: outcome.latencyMs ?? null,
        error: ok ? null : 'delivery failed',
      })
    }

    if (!anyFailed) {
      await q(
        `UPDATE notification_outbox
            SET status = 'delivered', locked_until = NULL, updated_at = NOW()
          WHERE id = $1`,
        [row.id],
      )
    } else {
      await failRow(qpool, row, 'delivery failed on one or more channels')
    }

    await tx.commit()
    tx.release()
  } catch (err) {
    await tx.rollback()
    tx.release()
    throw err
  }
}

/**
 * Mark every notification_job row for an outbox row as retrying/dead_letter.
 * Used on the exception path where dispatchOutbox threw before per-channel
 * outcomes could be recorded, so job rows stay consistent with the outbox row.
 */
async function failAllJobs(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  pool: any,
  row: OutboxRow,
  safeMessage: string,
): Promise<void> {
  // Commit the job updates, all dead-letter rows, and delivery logs atomically
  // on a pinned client in production (fallback: direct queries for test pool).
  const tx = await withWorkerTx(pool)
  const q = tx.q
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const qpool = { query: q } as any
  try {
    const attempts = row.attempts + 1
    const exhausted = attempts >= row.maxAttempts
    const runAfterMs = exhausted ? null : nextRetryDelayMs(attempts, row.maxAttempts)
    const runAfter = runAfterMs === null ? null : new Date(Date.now() + runAfterMs)
    const jobUpdates = await q(
      `UPDATE notification_job
          SET status = $2, attempts = $3, last_error = $4, run_after = $5,
              updated_at = NOW()
        WHERE outbox_id = $1
        RETURNING id, channel`,
      [row.id, exhausted ? 'dead_letter' : 'retrying', attempts, safeMessage || null, runAfter],
    )
    // Exception path: exhausted jobs are also copied to the dead-letter queue
    // (T-05.01.06) so the admin panel can triage them.
    if (exhausted) {
      const jobs = jobUpdates.rows as Array<{ id: string; channel: string }>
      for (const job of jobs) {
        await writeDeadLetter(qpool, {
          outboxId: row.id,
          jobId: job.id,
          channel: job.channel as NotificationChannel,
          eventKey: row.eventKey,
          profileId: row.profileId,
          userId: row.userId,
          attempts,
          maxAttempts: row.maxAttempts,
          idempotencyKey: row.idempotencyKey,
          cause: safeMessage || 'dispatch failed',
          errorCategory: classifyDeliveryError(safeMessage || 'dispatch failed'),
        })
      }
    }
    // Exception path: dispatch threw before per-channel outcomes were recorded,
    // so append one delivery log per requested channel describing the failure.
    for (const channel of row.channels) {
      await writeDeliveryLog(qpool, {
        notificationId: row.id,
        channel,
        delivered: false,
        attemptNumber: attempts,
        providerRef: null,
        latencyMs: null,
        error: safeMessage || 'dispatch failed',
      })
    }

    await tx.commit()
    tx.release()
  } catch (err) {
    await tx.rollback()
    tx.release()
    throw err
  }
}

/**
 * Mark a row as failed. Retry-eligible rows return to `queued` with a
 * `locked_until` back-off drawn from the T-05.01.03 retry ladder; only
 * exhausted rows become `failed` permanently (their jobs are dead-lettered).
 */
async function failRow(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  pool: any,
  row: OutboxRow,
  safeMessage: string,
): Promise<void> {
  const attempts = row.attempts + 1
  const exhausted = attempts >= row.maxAttempts
  const backoffMs = exhausted ? null : nextRetryDelayMs(attempts, row.maxAttempts)
  const backoffUntil = backoffMs === null ? null : new Date(Date.now() + backoffMs)

  await pool.query(
    `UPDATE notification_outbox
        SET status = $2, attempts = $3, last_error = $4, locked_until = $5,
            updated_at = NOW()
      WHERE id = $1`,
    [
      row.id,
      exhausted ? 'failed' : 'queued',
      attempts,
      safeMessage || null,
      backoffUntil,
    ],
  )
}

export type { OutboxReaderOptions, NotificationChannel, INotificationTransport }
