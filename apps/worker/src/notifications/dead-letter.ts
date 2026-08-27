import type { NotificationChannel } from '@barghsa/shared/notifications'
import { priorityForType } from './retry-schedule.js'
import { classifyDeliveryError } from './delivery-log.js'
import { sanitizeError } from './error-redact.js'

/**
 * Dead-letter writer (E-05, T-05.01.06).
 *
 * Recorded by the outbox worker the moment a `notification_job` exhausts its
 * retry budget. Copies the durable context the worker already holds — outbox
 * id, job id, channel, event key, retry budget, idempotency key, and the
 * sanitized final error — into `notification_dead_letter` so the admin panel
 * can triage `open` items, inspect their attempt history (via the delivery
 * log), and issue a Retry / Resolve / Dismiss action.
 *
 * Severity triage: an event type registered as `urgent` in the retry-schedule
 * registry (OTP, authentication, security events) is classified `critical`;
 * all other types are `error`. This keeps security-sensitive delivery
 * failures front-and-center in the ops view.
 */
export type DeadLetterSeverity = 'error' | 'critical'

/** Derive triage severity from the event type's queue priority class. */
export function deadLetterSeverity(eventKey: string): DeadLetterSeverity {
  return priorityForType(eventKey) === 'urgent' ? 'critical' : 'error'
}

export interface WriteDeadLetterInput {
  /** The outbox row id. */
  outboxId: string
  /** The per-channel job id that dead-lettered. */
  jobId: string
  /** The channel that exhausted its retries. */
  channel: NotificationChannel
  /** Business event key. */
  eventKey: string
  /** Recipient profile id (nullable). */
  profileId: string | null
  /** Recipient user id (nullable). */
  userId: string | null
  /** Retry attempts completed at the point the job dead-lettered. */
  attempts: number
  /** Retry budget the job exhausted. */
  maxAttempts: number
  /** Unique idempotency key (reused on retry). */
  idempotencyKey: string
  /** Raw error message (sanitized before persistence). */
  cause?: string | null
  /** Precomputed error classifier; otherwise derived from the cause. */
  errorCategory?: 'transient' | 'permanent' | 'provider' | null
  /** Precomputed severity; otherwise derived from the event type. */
  severity?: DeadLetterSeverity
}

/**
 * Log a dead-letter row for a job that exhausted its retries. Idempotent with
 * respect to `job_id`: if the same job dead-letters again (e.g. after an admin
 * Retry), the existing row is re-opened with fresh attempt/severity data
 * (guaranteed by the UNIQUE constraint on `job_id` added in migration 0027),
 * so a re-failure stays visible in the admin panel instead of silently
 * disappearing behind `ON CONFLICT DO NOTHING`. Uses the injected pool (real)
 * so it participates in the caller's transaction.
 */
export async function writeDeadLetter(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  pool: any,
  input: WriteDeadLetterInput,
): Promise<void> {
  const safeCause = input.cause ? sanitizeError(input.cause) : null
  const severity = input.severity ?? deadLetterSeverity(input.eventKey)
  const category = input.errorCategory ?? (safeCause ? classifyDeliveryError(safeCause) : null)
  await pool.query(
    `INSERT INTO notification_dead_letter
       (outbox_id, job_id, channel, event_key, severity, profile_id, user_id,
        cause, error_category, attempts, max_attempts, idempotency_key, status)
     VALUES ($1, $2, $3, $4, $5::text, $6, $7, $8,
             $9::text, $10, $11, $12, 'open')
     ON CONFLICT (job_id) DO UPDATE SET
       outbox_id = EXCLUDED.outbox_id,
       channel = EXCLUDED.channel,
       event_key = EXCLUDED.event_key,
       severity = EXCLUDED.severity,
       profile_id = EXCLUDED.profile_id,
       user_id = EXCLUDED.user_id,
       cause = EXCLUDED.cause,
       error_category = EXCLUDED.error_category,
       attempts = EXCLUDED.attempts,
       max_attempts = EXCLUDED.max_attempts,
       idempotency_key = EXCLUDED.idempotency_key,
       status = 'open',
       resolved_at = NULL,
       resolved_by = NULL,
       updated_at = NOW()`,
    [
      input.outboxId,
      input.jobId,
      input.channel,
      input.eventKey,
      severity,
      input.profileId ?? null,
      input.userId ?? null,
      safeCause,
      category,
      input.attempts,
      input.maxAttempts,
      input.idempotencyKey,
    ],
  )
}

/**
 * Alias kept for readability at call sites (derives the triage class). The
 * canonical name is `deadLetterSeverity`; `severityForEvent` is exported as a
 * backward-compatible alias.
 */
export const severityForEvent = deadLetterSeverity
