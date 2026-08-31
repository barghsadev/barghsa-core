/**
 * Background job triage contract (S-09.09, T-09.09.02).
 *
 * Single source of truth for the lifecycle of a *background job* — one
 * execution of a recurring worker task (service breach scan, service
 * escalation scan, notification outbox poll, …) that ended in a retryable
 * failure. The worker records failures into `background_jobs`; the admin
 * surface (`apps/api/src/admin/failed-jobs`) lists, retries, and resolves
 * them.
 *
 * Keeping the enum here prevents the worker (producer) and the API surface
 * (consumer) from drifting apart on allowed states, mirroring how the
 * reconciliation-exceptions states are shared for T-09.09.01.
 *
 * @module admin
 */

/**
 * Lifecycle states of a background job failure row.
 *
 * - `failed`       the worker recorded a failure; attempts < max_attempts;
 * - `retrying`     an admin requested a retry (or the worker is mid-backoff);
 *                   the next worker run re-attempts the job;
 * - `dead_letter`  the job exhausted its attempt budget and is quarantined;
 * - `resolved`     the job recovered (worker success) or an admin resolved it.
 */
export const BACKGROUND_JOB_STATUSES = [
  'failed',
  'retrying',
  'dead_letter',
  'resolved',
] as const

/** A background job lifecycle state. */
export type BackgroundJobStatus = (typeof BACKGROUND_JOB_STATUSES)[number]

/** Whether a raw value is a valid background job status. */
export function isBackgroundJobStatus(raw: unknown): raw is BackgroundJobStatus {
  return typeof raw === 'string' && (BACKGROUND_JOB_STATUSES as readonly string[]).includes(raw)
}

/**
 * Kinds of background job the worker currently records. Each entry pairs a
 * stable worker task key with the human-readable label the dashboard shows.
 */
export const BACKGROUND_JOB_TYPES = [
  { key: 'service_breach_scan', label: 'Service response-target breach scan' },
  { key: 'service_escalation_scan', label: 'Service escalation scan' },
  { key: 'notification_outbox_poll', label: 'Notification outbox poll' },
  { key: 'invoice_overdue_scan', label: 'Invoice overdue scan' },
  { key: 'invoice_reminder_scheduler', label: 'Invoice reminder scheduler' },
  { key: 'invoice_reminder_sender', label: 'Invoice reminder sender' },
] as const

/** A known background job type key. */
export type BackgroundJobType = (typeof BACKGROUND_JOB_TYPES)[number]['key']

/** Whether a raw value is a known background job type key. */
export function isBackgroundJobType(raw: unknown): raw is BackgroundJobType {
  return (
    typeof raw === 'string' &&
    (BACKGROUND_JOB_TYPES as readonly { key: string }[]).some((t) => t.key === raw)
  )
}

/** Resolve the human-readable label for a job type key. */
export function backgroundJobLabel(jobType: string): string {
  const entry = (BACKGROUND_JOB_TYPES as readonly { key: string; label: string }[]).find(
    (t) => t.key === jobType,
  )
  return entry?.label ?? jobType
}
