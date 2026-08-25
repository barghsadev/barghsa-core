import { pgTable, text, timestamp } from 'drizzle-orm/pg-core'
import { users } from './users.js'

/**
 * Audit log table (T-02.03.02).
 *
 * Records security-sensitive events for audit trail compliance.
 * Each entry captures the event type, affected user, metadata,
 * correlation ID, and source IP at the time of the event.
 *
 * Events are append-only — entries are never updated or deleted.
 */
export const auditLog = pgTable(
  'audit_log',
  {
    /** UUIDv7 opaque entry identifier. */
    id: text('id').primaryKey(),

    /** The user who performed (or was affected by) the action. */
    userId: text('user_id')
      .notNull()
      .references(() => users.userId, { onDelete: 'restrict' }),

    /** Machine-readable event name, e.g. 'password_reset', 'login', 'otp_sent'. */
    event: text('event').notNull(),

    /** Optional JSON-encoded metadata payload */
    metadata: text('metadata'),

    /** Correlation ID linking related events across services. */
    correlationId: text('correlation_id'),

    /** Source IP address at the time of the event. */
    ip: text('ip'),

    /** When the event occurred. */
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' })
      .defaultNow()
      .notNull(),
  },
)