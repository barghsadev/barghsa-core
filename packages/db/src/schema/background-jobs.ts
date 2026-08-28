import { jsonb, integer, text, timestamp } from 'drizzle-orm/pg-core'
import { createTable } from '../base-table.js'
import { users } from './users.js'

/**
 * Background job failure ledger (S-09.09, T-09.09.02).
 *
 * One row per *active* retryable failure of a recurring worker task (a named
 * scan/loop execution). Rows are produced by the worker (apps/worker job
 * recorder) and reviewed / retried / resolved by admin/staff through the
 * admin "failed jobs dashboard" surface in `apps/api/src/admin`.
 *
 * Row layout:
 * - `jobType`        stable worker task key, e.g. service_breach_scan —
 *   must stay in sync with BACKGROUND_JOB_TYPES in @barghsa/shared/admin
 * - `status`         failed | retrying | dead_letter | resolved
 * - `error`          sanitized last error message (never raw secrets)
 * - `errorCategory`  transient | permanent | provider; permanent is not
 *   auto-retried (avoids hot loops)
 * - `attempts`       how many times this failure has been observed
 * - `maxAttempts`    retry budget before the job is dead-lettered
 * - `payload`        JSONB masked job context (audit copy for triage)
 * - `firstFailedAt`  first time this failure was recorded
 * - `lastRunAt`      most recent attempt time
 * - `nextRunAt`      back-off time after which a 'retrying' job may re-run
 * - `resolvedById`   the admin who resolved the job (FK users, SET NULL)
 * - `resolvedAt`     when the job was resolved
 *
 * Invariants enforced by the service layer (T-09.09.02):
 * - the worker upserts a *current* failure row per job_type: an active
 *   'failed'/'retrying'/'dead_letter' row is incremented, otherwise a new
 *   row is created (the DB enforces at most one active row per type via the
 *   partial unique index `uq_background_jobs_active_per_type`);
 * - 'retrying'    admin requested a retry; the next worker run re-attempts;
 * - 'dead_letter' attempts reached max_attempts; quarantined for triage;
 * - 'resolved'    terminal; never auto-revived by the worker.
 *
 * Database-level CHECK constraints and indexes live in migration `0041` only
 * (Drizzle's column builder in v0.40 does not expose `.check()`):
 * `chk_bj_status`, `chk_bj_error_category`, `chk_bj_attempts_ge_1`,
 * `chk_bj_max_attempts_ge_1`, the composite list index
 * `idx_background_jobs_status_first_failed_at`, and the partial unique
 * `uq_background_jobs_active_per_type`.
 * `background-jobs.test.ts` pins migration 0041 so a future
 * `drizzle-kit generate` cannot silently drop them.
 *
 * @module db/schema
 */
export const backgroundJobs = createTable('background_jobs', {
  /** Stable worker task key, e.g. service_breach_scan. */
  jobType: text('job_type').notNull(),

  /** Lifecycle state: failed | retrying | dead_letter | resolved. */
  status: text('status').notNull().default('failed'),

  /** Sanitized last error message (never raw secrets). */
  error: text('error'),

  /** transient | permanent | provider — permanent is not auto-retried. */
  errorCategory: text('error_category').notNull().default('transient'),

  /** How many times this failure has been observed. */
  attempts: integer('attempts').notNull().default(1),

  /** Retry budget before the job is dead-lettered. */
  maxAttempts: integer('max_attempts').notNull().default(5),

  /** JSONB masked job context (audit copy for triage). */
  payload: jsonb('payload').notNull().default({}),

  /** First time this failure was recorded. */
  firstFailedAt: timestamp('first_failed_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),

  /** Most recent attempt time. */
  lastRunAt: timestamp('last_run_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),

  /** Back-off time after which a 'retrying' job may be re-run. */
  nextRunAt: timestamp('next_run_at', { withTimezone: true, mode: 'date' }),

  /** The admin who resolved the job. */
  resolvedById: text('resolved_by_id').references(() => users.userId, {
    onDelete: 'set null',
  }),

  /** When the job was resolved. */
  resolvedAt: timestamp('resolved_at', { withTimezone: true, mode: 'date' }),
})
