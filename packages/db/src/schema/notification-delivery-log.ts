import { pgTable, text, integer, index } from 'drizzle-orm/pg-core'
import { uuidv7, timestamptz } from '../types.js'
import { notificationOutbox } from './notification-outbox.js'

/**
 * Notification delivery log table (E-05, T-05.01.05).
 *
 * Append-only audit trail of every delivery attempt performed by the outbox
 * worker. One row is written per `(notification, channel, attempt)` so the
 * admin panel can reconstruct the full delivery history of a notification:
 * when each channel was attempted, how long the provider took, what provider
 * ref (if any) it returned, and — on failure — a safe, classified error.
 *
 * Lifecycle / semantics:
 * - `status` — outcome of this attempt: 'delivered' (provider accepted) or
 *   'failed' (attempt gave up / errored).
 * - `attempt_number` — 1-based attempt index within this channel's job.
 * - `provider_ref` — real provider reference returned by the transport, or
 *   NULL when the attempt did not reach the provider.
 * - `latency_ms` — round-trip time of the provider call, NULL when the
 *   attempt errored before measuring a meaningful duration.
 * - `error_category` — coarse classifier used for admin triage: 'transient'
 *   (retryable, e.g. timeouts/5xx), 'permanent' (non-retryable, e.g. validation),
 *   or 'provider' (provider-side rejection).
 * - `error_detail` — **sanitized** error detail. The worker applies the same
 *   redaction used for `notification_outbox.last_error` so provider messages
 *   can never leak credentials or connection strings.
 *
 * Querying: filtered by `notification_id`, `channel`, `status`, and
 * `error_category`; ordered newest-first for the admin panel.
 */
export const notificationDeliveryLog = pgTable(
  'notification_delivery_log',
  {
    /** UUIDv7 primary key. */
    id: uuidv7('id').primaryKey().notNull(),

    /** The outbox row (notification) this attempt belongs to. */
    notificationId: uuidv7('notification_id')
      .notNull()
      .references(() => notificationOutbox.id, { onDelete: 'cascade' }),

    /** The channel this attempt delivered to. */
    channel: text('channel', { enum: ['in_app', 'email', 'sms'] }).notNull(),

    /** Outcome of this attempt: 'delivered' or 'failed'. */
    status: text('status', { enum: ['delivered', 'failed'] }).notNull(),

    /** 1-based attempt number within this channel's job. */
    attemptNumber: integer('attempt_number').notNull(),

    /** Provider reference returned by the transport, if any. */
    providerRef: text('provider_ref'),

    /** Provider round-trip latency in milliseconds, if measurable. */
    latencyMs: integer('latency_ms'),

    /** Error classifier: 'transient' | 'permanent' | 'provider'. */
    errorCategory: text('error_category', {
      enum: ['transient', 'permanent', 'provider'],
    }),

    /** Sanitized error detail from the failed attempt (never leaks secrets). */
    errorDetail: text('error_detail'),

    /** When the attempt was recorded. */
    createdAt: timestamptz('created_at').defaultNow().notNull(),
  },
  (table) => [
    // Admin panel queries by notification id first, then newest-first.
    index('idx_ndl_notification').on(table.notificationId, table.createdAt),
    // Triaging a channel or an error class across notifications.
    index('idx_ndl_channel_status').on(table.channel, table.status),
    index('idx_ndl_created').on(table.createdAt),
  ],
)
