import { pgTable, text, integer, index } from 'drizzle-orm/pg-core'
import { uuidv7, timestamptz } from '../types.js'
import { notificationOutbox } from './notification-outbox.js'
import { notificationJob } from './notification-outbox.js'

/**
 * Dead-letter queue record (E-05, T-05.01.06).
 *
 * One row is written by the outbox worker when a `notification_job` exhausts
 * its retry budget and moves to `dead_letter`. It inherits the failed
 * delivery data — the outbox row, the job, the profile recipient, the final
 * sanitized cause and that channel's attempt history is reconstructable from
 * `notification_delivery_log` — so the admin panel can triage without chasing
 * across tables.
 *
 * Lifecycle / semantics:
 * - `severity` — triage class for the ops view: 'critical' for urgent /
 *   security-sensitive event types (OTP, authentication, payment) and
 *   'error' for everything else.
 * - `cause` — the **sanitized** final error the job died on (never logs
 *   credentials), copied from the job's `last_error`.
 * - `errorCategory` — coarse classifier ('transient' | 'permanent' |
 *   'provider') reused from the delivery-log taxonomy for triage.
 * - `status` — admin workflow state:
 *     'open'     awaiting triage (this is what the ops panel shows by default),
 *     'retried'  admin re-queued it (idempotency key preserved, no double-delivery),
 *     'resolved' admin marked it final — no further retry,
 *     'dismissed' admin acknowledged/dismissed it from the active view.
 *   Actions transition `open → retried | resolved | dismissed` (idempotent;
 *   re-acting on an already-resolved row is a no-op that returns the row).
 * - `idempotency_key` — the outbox row's unique key. Retry re-queues the SAME
 *   job using this key so re-processing cannot double-deliver (T-05.01.04).
 *
 * Purge: the worker keeps only 'open' rows eligible for re-dispatch; after an
 * admin resolves/dismisses, the row is retained as an audit record. A periodic
 * cleanup can archive rows older than a retention window (not part of this
 * story's DB — see T-05.01.07 retention).
 */
export const notificationDeadLetter = pgTable(
  'notification_dead_letter',
  {
    /** UUIDv7 primary key. */
    id: uuidv7('id').primaryKey().notNull(),

    /** The outbox row (notification) whose job dead-lettered. */
    outboxId: uuidv7('outbox_id')
      .notNull()
      .references(() => notificationOutbox.id, { onDelete: 'cascade' }),

    /** The per-channel job that exhausted its retries. UNIQUE so re-processing
     *  the same job is idempotent (`ON CONFLICT (job_id) DO NOTHING`). */
    jobId: uuidv7('job_id')
      .notNull()
      .unique()
      .references(() => notificationJob.id, { onDelete: 'cascade' }),

    /** The channel this dead-letter applies to. */
    channel: text('channel', { enum: ['in_app', 'email', 'sms'] }).notNull(),

    /** Event key the notification delivered for (template lookup). */
    eventKey: text('event_key').notNull(),

    /** Triage severity: 'critical' for urgent/security types, else 'error'. */
    severity: text('severity', { enum: ['error', 'critical'] }).notNull().default('error'),

    /** Recipient profile. */
    profileId: uuidv7('profile_id'),
    /** Recipient user when the target is a user (in-app). */
    userId: text('user_id'),

    /** Sanitized final error message (never leaks secrets). */
    cause: text('cause'),

    /** Coarse error classifier carried over from the delivery log. */
    errorCategory: text('error_category', {
      enum: ['transient', 'permanent', 'provider'],
    }),

    /** Attempt count at the time the job dead-lettered. */
    attempts: integer('attempts').notNull().default(0),

    /** Retry budget the job exhausted. */
    maxAttempts: integer('max_attempts').notNull().default(5),

    /** Unique idempotency key reused on retry (T-05.01.04). */
    idempotencyKey: text('idempotency_key').notNull(),

    /** Lifecycle state, see module comment. */
    status: text('status', {
      enum: ['open', 'retried', 'resolved', 'dismissed'],
    })
      .notNull()
      .default('open'),

    resolvedAt: timestamptz('resolved_at'),
    resolvedBy: text('resolved_by'),

    createdAt: timestamptz('created_at').defaultNow().notNull(),
    updatedAt: timestamptz('updated_at')
      .defaultNow()
      .notNull()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    // Ops panel default query: open items newest-first.
    index('idx_ndl_status_created').on(table.status, table.createdAt),
    // Triage by severity across all statuses.
    index('idx_ndl_severity').on(table.severity),
    // Lookup a single notification's dead-letter history.
    index('idx_ndl_outbox').on(table.outboxId),
  ],
)
