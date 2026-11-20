import { sql } from 'drizzle-orm';
import { check, index, integer, pgTable, text, timestamp } from 'drizzle-orm/pg-core';

export const storageWebhookEvents = pgTable(
  'storage_webhook_events',
  {
    eventId: text('event_id').primaryKey(),
    encryptedPayload: text('encrypted_payload').notNull(),
    receivedAt: timestamp('received_at', { withTimezone: true }).notNull().defaultNow(),
    availableAt: timestamp('available_at', { withTimezone: true }).notNull().defaultNow(),
    attempts: integer('attempts').notNull().default(0),
    processedAt: timestamp('processed_at', { withTimezone: true }),
    outcome: text('outcome', { enum: ['observed', 'ignored'] }),
  },
  (table) => [
    check('storage_webhook_event_id', sql`${table.eventId} ~ '^[0-9a-f]{64}$'`),
    check('storage_webhook_attempts', sql`${table.attempts} >= 0`),
    check(
      'storage_webhook_event_outcome',
      sql`(${table.processedAt} IS NULL AND ${table.outcome} IS NULL)
          OR (${table.processedAt} IS NOT NULL AND ${table.outcome} IS NOT NULL
              AND ${table.outcome} IN ('observed', 'ignored'))`
    ),
    index('storage_webhook_events_due_idx')
      .on(table.availableAt, table.eventId)
      .where(sql`${table.processedAt} IS NULL`),
  ]
);
