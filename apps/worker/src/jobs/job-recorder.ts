import { getDbPool } from '@barghsa/db'
import {
  BACKGROUND_JOB_TYPES,
  type BackgroundJobType,
} from '@barghsa/shared/admin'
import { sanitizeError } from '../notifications/error-redact.js'

/**
 * Default retry budget before a job is dead-lettered (T-09.09.02).
 */
export const DEFAULT_MAX_ATTEMPTS = 5

/**
 * Back-off applied when a job is marked `retrying` (or keeps failing), so
 * the admin dashboard reflects a delay before the next re-run. The worker's
 * recurring loops re-run on their own cadence regardless; this field is for
 * triage display and future schedule-aware runners.
 */
const RETRY_BACKOFF_MS = 60_000

/**
 * Input for {@link recordJobFailure}.
 */
export interface RecordFailureInput {
  /** Stable worker task key, e.g. 'service_breach_scan'. */
  jobType: BackgroundJobType
  /** Sanitized error message (never raw secrets). */
  error: string
  /** Whether the failure is transient (retryable) or permanent. */
  errorCategory?: 'transient' | 'permanent' | 'provider'
  /** Masked job context for triage (must not contain secrets). */
  payload?: Record<string, unknown>
  /** Retry budget before the job is dead-lettered. */
  maxAttempts?: number
}

/**
 * Background-job failure recorder (S-09.09, T-09.09.02).
 *
 * Best-effort, non-fatal producer for the admin "Failed jobs dashboard".
 * The worker calls {@link recordJobFailure} whenever a recurring scan/loop
 * throws, and {@link recordJobSuccess} on the next clean run. Every call is
 * wrapped so a ledger write can never mask the underlying worker error.
 *
 * Semantics:
 * - one *active* failure row per job_type (the DB enforces at most one via
 *   the partial unique index `uq_background_jobs_active_per_type` for
 *   statuses failed/retrying/dead_letter);
 * - a new failure INSERTs a fresh row (status failed, attempts=1);
 * - a repeat failure on an active row increments attempts and advances the
 *   back-off; when attempts reach max, the row is dead-lettered;
 * - a success resolves any active row for that job_type (auto-clear), so a
 *   job that recovers leaves the dashboard.
 */
export async function recordJobFailure(
  input: RecordFailureInput,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  pool?: any,
): Promise<void> {
  try {
    const p = pool ?? getDbPool()
    const safeMessage = sanitizeError(input.error)
    const category = input.errorCategory ?? 'transient'
    const maxAttempts = Number.isInteger(input.maxAttempts) && (input.maxAttempts ?? 0) >= 1
      ? (input.maxAttempts as number)
      : DEFAULT_MAX_ATTEMPTS
    const now = new Date()
    const nextRunAt = new Date(now.getTime() + RETRY_BACKOFF_MS)

    const existing = await p.query(
      `SELECT id, attempts, status
         FROM background_jobs
        WHERE job_type = $1
          AND status IN ('failed', 'retrying', 'dead_letter')
        ORDER BY first_failed_at DESC
        LIMIT 1
        FOR UPDATE`,
      [input.jobType],
    )

    const row = existing.rows[0] as
      | { id: string; attempts: number; status: string }
      | undefined

    if (!row) {
      await p.query(
        `INSERT INTO background_jobs
           (job_type, status, error, error_category, attempts, max_attempts,
            payload, first_failed_at, last_run_at, next_run_at,
            created_at, updated_at)
         VALUES ($1, 'failed', $2, $3, 1, $4, $5::jsonb, $6, $6, $7, $6, $6)`,
        [
          input.jobType,
          safeMessage || null,
          category,
          maxAttempts,
          JSON.stringify(input.payload ?? {}),
          now,
          nextRunAt,
        ],
      )
      return
    }

    const attempts = row.attempts + 1
    const exhausted = attempts >= maxAttempts
    const nextStatus = exhausted ? 'dead_letter' : row.status === 'dead_letter' ? 'dead_letter' : row.status
    await p.query(
      `UPDATE background_jobs
          SET status = $2,
              error = $3,
              error_category = $4,
              attempts = $5,
              max_attempts = $6,
              payload = $7::jsonb,
              last_run_at = $8,
              next_run_at = $9,
              updated_at = $8
        WHERE id = $1`,
      [
        row.id,
        nextStatus,
        safeMessage || null,
        category,
        attempts,
        maxAttempts,
        JSON.stringify(input.payload ?? {}),
        now,
        exhausted ? null : nextRunAt,
      ],
    )
  } catch (err) {
    // A ledger failure must never crash the worker loop.
    // eslint-disable-next-line no-console
    console.error(`[worker] failed to record job failure: ${sanitizeError(String(err))}`)
  }
}

/**
 * Mark the active failure row for a job type `resolved` after a clean run.
 * No-op when there is no active failure (the common case). A resolved row is
 * excluded from the active partial index, so a future failure starts fresh.
 */
export async function recordJobSuccess(
  jobType: BackgroundJobType,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  pool?: any,
): Promise<void> {
  try {
    const p = pool ?? getDbPool()
    const now = new Date()
    await p.query(
      `UPDATE background_jobs
          SET status = 'resolved',
              resolved_at = COALESCE(resolved_at, $2),
              next_run_at = NULL,
              updated_at = $2
        WHERE job_type = $1
          AND status IN ('failed', 'retrying', 'dead_letter')`,
      [jobType, now],
    )
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error(`[worker] failed to record job success: ${sanitizeError(String(err))}`)
  }
}

/** Re-export the known job types so worker call sites validate keys. */
export const JOB_TYPES = BACKGROUND_JOB_TYPES.map((t) => t.key)
