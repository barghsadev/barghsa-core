import { pgTable, text, jsonb, uniqueIndex, index } from 'drizzle-orm/pg-core'
import { uuidv7, timestamptz } from '../types.js'
import { notificationOutbox } from './notification-outbox.js'

/**
 * Durable record of a verified Resend webhook event (E-05, T-05.06.07).
 *
 * One row is written per distinct webhook event delivered by Resend. It
 * serves two purposes:
 *
 * 1. **Idempotency / replay protection.** Resend re-delivers an event (with
 *    the same `svix-id`) until we acknowledge it, and attackers may replay a
 *    captured payload. `event_token` (the `svix-id` header) is UNIQUE, so a
 *    re-delivered or replayed event inserts nothing and is ignored — each
 *    event's side effects (outbox status update, suppression) run at most
 *    once.
 * 2. **Audit trail.** `raw` snapshots the verified payload so operations can
 *    reconstruct what the provider reported for a given message.
 *
 * Resolution: `outbox_id` and `profile_id` are back-filled when the event's
 * provider message id (`message_id`) matches a known `notification_outbox`
 * row, so suppression and delivery-state updates are attributable to the
 * originating notification when one is known.
 */
export const emailWebhookEvents = pgTable(
  'email_webhook_events',
  {
    /** UUIDv7 primary key. */
    id: uuidv7('id').primaryKey().notNull(),

    /** The `svix-id` header — stable across provider retries; idempotency key. */
    eventToken: text('event_token').notNull(),

    /** Resend event type, e.g. 'email.delivered', 'email.bounced'. */
    eventType: text('event_type').notNull(),

    /** Provider message id (`data.email_id`) the event refers to. */
    messageId: text('message_id'),

    /** Recipient address (`data.to`) for suppression / attribution. */
    toAddress: text('to_address'),

    /** Sender address (`data.from`), when present. */
    fromAddress: text('from_address'),

    /** The outbox row matched via `message_id` (nullable when unmatched). */
    outboxId: uuidv7('outbox_id').references(() => notificationOutbox.id, {
      onDelete: 'set null',
    }),

    /** Coarse outcome derived for the admin panel: delivered/failed/open/clicked/complained. */
    status: text('status', {
      enum: ['delivered', 'failed', 'opened', 'clicked', 'complained'],
    }),

    /** Full verified event payload snapshot (audit / triage). */
    raw: jsonb('raw'),

    createdAt: timestamptz('created_at').defaultNow().notNull(),
  },
  (table) => [
    // Idempotency gate: a repeated `svix-id` must insert nothing.
    uniqueIndex('uq_email_webhook_event_token').on(table.eventToken),
    // Triaging by provider message id (delivery-state reconciliation).
    index('idx_ewe_message').on(table.messageId),
    index('idx_ewe_address').on(table.toAddress),
  ],
)