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
 * Back-off applied when a job keeps failing, so the admin dashboard reflects
 * a delay before the next re-run. The worker's recurring loops re-run on
 * their own cadence regardless; this field is for triage display and future
 * schedule-aware runners.
 */
const RETRY_BACKOFF_MS = 60_000

/**
 * The predicate of the `background_jobs` partial unique index that scopes the
 * `ON CONFLICT` upsert target (see migration 0041). Kept in one place so the
 * recorder SQL and the migration constraint cannot drift.
 */
const ACTIVE_STATUSES_SQL = "status IN ('failed', 'retrying', 'dead_letter')"

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
 * Reliability: the failure path is a single atomic `INSERT ... ON CONFLICT`
 * upsert scoped to the partial unique index
 * `uq_background_jobs_active_per_type`. PostgreSQL serialises concurrent
 * writers on that index, so two overlapping poll ticks (or two worker
 * replicas) can never both insert a second active row nor lose an attempt
 * increment — unlike a SELECT-then-write read-modify-write, which races.
 *
 * Semantics:
 * - a fresh failure INSERTs a row (status failed, attempts=1);
 * - a repeat failure on an active row increments attempts; once attempts
 *   reach max the row is dead-lettered, otherwise it returns to `failed`
 *   (a `retrying` row reverts to `failed` on a new failure so it shows
 *   under the dashboard's Failed filter);
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

    await p.query(
      `INSERT INTO background_jobs
         (job_type, status, error, error_category, attempts, max_attempts,
          payload, first_failed_at, last_run_at, next_run_at,
          created_at, updated_at)
       VALUES ($1, 'failed', $2, $3, 1, $4, $5::jsonb, $6, $6, $7, $6, $6)
       ON CONFLICT (job_type) WHERE ${ACTIVE_STATUSES_SQL}
       DO UPDATE SET
         status = CASE
                    WHEN background_jobs.attempts + 1 >= EXCLUDED.max_attempts
                      THEN 'dead_letter'
                    ELSE 'failed'
                  END,
         error = EXCLUDED.error,
         error_category = EXCLUDED.error_category,
         attempts = background_jobs.attempts + 1,
         max_attempts = EXCLUDED.max_attempts,
         payload = EXCLUDED.payload,
         last_run_at = EXCLUDED.last_run_at,
         next_run_at = CASE
                         WHEN background_jobs.attempts + 1 >= EXCLUDED.max_attempts
                           THEN NULL
                         ELSE EXCLUDED.next_run_at
                       END,
         updated_at = EXCLUDED.last_run_at`,
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
