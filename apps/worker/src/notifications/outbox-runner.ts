import { getDbPool } from '@barghsa/db'
import type { INotificationTransport, NotificationChannel } from '@barghsa/shared/notifications'
import { leaseOutbox, dispatchOutbox, type OutboxRow, type OutboxReaderOptions } from './outbox-reader.js'

/**
 * Outbox dispatch runner (E-05, T-05.01.02).
 *
 * Ties the durable write pipeline together on the consuming side:
 * each poll leases due outbox rows (`leaseOutbox`), marks them `sending`,
 * dispatches every requested channel through the registered transports
 * (`dispatchOutbox`), then records the aggregate outcome back on the outbox
 * row and its per-channel `notification_job` rows.
 *
 * Lifecycle handled here:
 *   queued/scheduled → sending (leased) → delivered | failed
 *
 * Retry scheduling with backoff+jitter and dead-letter transitions are the
 * concern of T-05.01.03/T-05.01.06; this runner faithfully records the last
 * outcome and per-attempt `last_error` so those layers can build on it.
 */
export interface OutboxRunResult {
  /** Number of outbox rows claimed in this poll. */
  leased: number
  /** Number of rows whose channels all delivered. */
  delivered: number
  /** Number of rows that failed at least one channel. */
  failed: number
}

/** How long a dispatched-but-unconfirmed row stays `sending` before re-claim. */
const SENDING_LEASE_MS = 30_000

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
      // Any per-channel failure fails the row; in-app failure throws above.
      const anyFailed = outcomes.some((o) => o.result.status === 'failed')

      if (anyFailed) {
        await failRow(pool, row)
        result.failed += 1
      } else {
        await succeedRow(pool, row)
        result.delivered += 1
      }
    } catch (err) {
      await failRow(pool, row, err)
      result.failed += 1
    }
  }

  return result
}

/** Record a fully-delivered row and mark its jobs done. */
async function succeedRow(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  pool: any,
  row: OutboxRow,
): Promise<void> {
  await pool.query(
    `UPDATE notification_outbox
        SET status = 'delivered', locked_until = NULL, provider_ref = $2,
            updated_at = NOW()
      WHERE id = $1`,
    [row.id, `delivered:${row.id}`],
  )
  await pool.query(
    `UPDATE notification_job
        SET status = 'done', updated_at = NOW()
      WHERE outbox_id = $1`,
    [row.id],
  )
}

/** Record a failed row, incrementing its attempt count and stashing last_error. */
async function failRow(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  pool: any,
  row: OutboxRow,
  err?: unknown,
): Promise<void> {
  const safeMessage = err instanceof Error ? err.message : String(err)
  const attempts = row.attempts + 1
  const failed = attempts >= row.maxAttempts

  await pool.query(
    `UPDATE notification_outbox
        SET status = $2, attempts = $3, last_error = $4, locked_until = NULL,
            updated_at = NOW()
      WHERE id = $1`,
    [row.id, failed ? 'failed' : 'sending', attempts, safeMessage || null],
  )
  await pool.query(
    `UPDATE notification_job
        SET status = 'failed', attempts = $2, last_error = $3, updated_at = NOW()
      WHERE outbox_id = $1`,
    [row.id, attempts, safeMessage || null],
  )
}

export type { OutboxReaderOptions, NotificationChannel, INotificationTransport }
