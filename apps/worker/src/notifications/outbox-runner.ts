import { getDbPool } from '@barghsa/db'
import type { INotificationTransport, NotificationChannel } from '@barghsa/shared/notifications'
import { leaseOutbox, dispatchOutbox, type OutboxRow, type OutboxReaderOptions } from './outbox-reader.js'
import { nextRetryDelayMs } from './retry-schedule.js'

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
/** Maximum length of a persisted `last_error`. */
const LAST_ERROR_MAX_LEN = 500

/**
 * Redact likely secret material from an error message and cap its length, so
 * transport errors (SMTP/SMS/Gateway) can never leak credentials into
 * `last_error`. Matches common patterns: bearer tokens, api keys, passwords,
 * and credentials embedded in URLs.
 */
export function sanitizeLastError(message: string): string {
  const SECRET_PATTERNS: Array<{ re: RegExp; replacement: string }> = [
    { re: /(bearer\s+)[A-Za-z0-9._~+/=-]+/gi, replacement: '$1[REDACTED]' },
    { re: /(api[_-]?key\s*[=:]\s*)[^\s,;]+/gi, replacement: '$1[REDACTED]' },
    { re: /(password\s*[=:]\s*)[^\s,;]+/gi, replacement: '$1[REDACTED]' },
    { re: /(secret\s*[=:]\s*)[^\s,;]+/gi, replacement: '$1[REDACTED]' },
    { re: /(token\s*[=:]\s*)[^\s,;]+/gi, replacement: '$1[REDACTED]' },
    { re: /([a-z][a-z0-9+.-]*:\/\/)[^/\s:@]+(:[^@\s/]*)?@/gi, replacement: '$1[REDACTED]@' },
    // Known provider/token shapes (AWS, OpenAI, GitHub, Slack, Stripe).
    { re: /\bAKIA[0-9A-Z]{16}\b/g, replacement: '[REDACTED]' },
    { re: /\bsk-[A-Za-z0-9_-]{20,}\b/g, replacement: '[REDACTED]' },
    { re: /\b(ghp|gho|ghu|github_pat)_[A-Za-z0-9_]{20,}\b/g, replacement: '[REDACTED]' },
    { re: /\bxox[baprs]-[A-Za-z0-9-]{20,}\b/g, replacement: '[REDACTED]' },
    { re: /\bsk_live_[A-Za-z0-9]{20,}\b/g, replacement: '[REDACTED]' },
    // Generic long alphanumeric run — high threshold to avoid scrubbing UUIDs
    // and short transaction/hash identifiers while still catching raw keys.
    { re: /([A-Za-z0-9]{48,})/g, replacement: '[REDACTED]' },
  ]
  let out = message
  for (const p of SECRET_PATTERNS) {
    out = out.replace(p.re, p.replacement)
  }
  return out.slice(0, LAST_ERROR_MAX_LEN)
}

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
  let anyFailed = false
  for (const outcome of outcomes) {
    const ok = outcome.result.status === 'delivered'
    if (!ok) anyFailed = true
    const attempts = row.attempts + 1
    const exhausted = attempts >= row.maxAttempts
    // Jittered backoff before the next attempt (null when the budget is spent).
    const runAfterMs = exhausted ? null : nextRetryDelayMs(attempts, row.maxAttempts)
    const runAfter = runAfterMs === null ? null : new Date(Date.now() + runAfterMs)
    await pool.query(
      `UPDATE notification_job
          SET status = $2, provider_ref = $3, attempts = $4, last_error = $5,
              run_after = $7, updated_at = NOW()
        WHERE outbox_id = $1 AND channel = $6`,
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
  }

  if (!anyFailed) {
    await pool.query(
      `UPDATE notification_outbox
          SET status = 'delivered', locked_until = NULL, updated_at = NOW()
        WHERE id = $1`,
      [row.id],
    )
  } else {
    await failRow(pool, row, 'delivery failed on one or more channels')
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
  const attempts = row.attempts + 1
  const exhausted = attempts >= row.maxAttempts
  const runAfterMs = exhausted ? null : nextRetryDelayMs(attempts, row.maxAttempts)
  const runAfter = runAfterMs === null ? null : new Date(Date.now() + runAfterMs)
  await pool.query(
    `UPDATE notification_job
        SET status = $2, attempts = $3, last_error = $4, run_after = $5,
            updated_at = NOW()
      WHERE outbox_id = $1`,
    [row.id, exhausted ? 'dead_letter' : 'retrying', attempts, safeMessage || null, runAfter],
  )
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
