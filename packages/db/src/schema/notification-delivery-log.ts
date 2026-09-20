import { domainChecks } from '../domain-checks';
import { pgTable, text, integer, index, uuid } from 'drizzle-orm/pg-core';
import { uuidv7, timestamptz } from '../types.js';
import { notificationOutbox } from './notification-outbox.js';

/**
 * Delivery history. External sends create a durable row before provider I/O,
 * then update its outcome atomically with the receipt. Each retry has a unique
 * send token; recovery reuses the original row. In-app and preflight outcomes
 * are recorded by worker bookkeeping. Historical processing rows are retained.
 * A sending row means the attempt started but no outcome was durably recorded;
 * it does not prove that a worker or provider request is still running.
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

    /** Recorded outcome; sending/unknown must not imply success or safe retry. */
    status: text('status', { enum: ['delivered', 'failed', 'sending', 'unknown'] }).notNull(),

    /** Stable token for a durable external attempt; legacy/local rows have none. */
    sendAttemptToken: uuid('send_attempt_token').unique(),

    /** 1-based history sequence within this channel. */
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
    ...domainChecks('notification_delivery_log'),
    // Admin panel queries by notification id first, then newest-first.
    index('idx_ndl_notification').on(table.notificationId, table.createdAt),
    // Triaging a channel or an error class across notifications.
    index('idx_ndl_channel_status').on(table.channel, table.status),
    index('idx_ndl_created').on(table.createdAt),
  ]
);
