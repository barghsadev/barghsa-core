import { pgTable, text, uniqueIndex, index } from 'drizzle-orm/pg-core'
import { uuidv7, timestamptz } from '../types.js'
import { profiles } from './profiles.js'
import { emailWebhookEvents } from './email-webhook-events.js'

/**
 * Suppressed email addresses (E-05, T-05.06.07).
 *
 * Hard bounces and spam complaints degrade the sending domain's reputation and
 * can get an account suspended, so those recipients are recorded here and the
 * email send path must skip non-essential email to a suppressed address.
 *
 * Semantics:
 * - `reason = 'hard_bounce'` — the provider reported a permanent bounce
 *   (address does not exist). Duplicate/suppressed from non-essential sends.
 * - `reason = 'complaint'` — the recipient marked a message as spam; suppressed
 *   and surfaced as a corrective-action record for the operations team.
 *
 * Idempotency: `address` + `reason` is UNIQUE, so a provider report already
 * handled is a no-op even if a replay were to reach this table independently
 * of the webhook-event ledger.
 */
export const emailSuppressions = pgTable(
  'email_suppressions',
  {
    /** UUIDv7 primary key. */
    id: uuidv7('id').primaryKey().notNull(),

    /** Normalized (lowercased) recipient address that must not receive non-essential email. */
    address: text('address').notNull(),

    /** Why the address is suppressed: hard bounce or spam complaint. */
    reason: text('reason', { enum: ['hard_bounce', 'complaint'] }).notNull(),

    /** The receiving profile when the originating outbox row was resolvable. */
    profileId: uuidv7('profile_id').references(() => profiles.id, {
      onDelete: 'cascade',
    }),

    /** The verified webhook event that created this suppression. */
    sourceEventId: uuidv7('source_event_id').references(() => emailWebhookEvents.id, {
      onDelete: 'set null',
    }),

    createdAt: timestamptz('created_at').defaultNow().notNull(),
  },
  (table) => [
    // At most one suppression per (address, reason) — replay-safe.
    uniqueIndex('uq_email_suppression').on(table.address, table.reason),
    index('idx_email_suppression_address').on(table.address),
  ],
)