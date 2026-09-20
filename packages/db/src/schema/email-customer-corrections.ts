import { sql } from 'drizzle-orm';
import { check, index, pgTable, text, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { uuidv7, timestamptz } from '../types.js';
import { profiles } from './profiles.js';
import { users } from './users.js';
import { emailWebhookEvents } from './email-webhook-events.js';

/** Staff follow-up for a signed email complaint. Resolution never clears suppression. */
export const emailCustomerCorrections = pgTable(
  'email_customer_corrections',
  {
    id: uuidv7('id').primaryKey().notNull(),
    address: text('address').notNull(),
    profileId: uuid('profile_id').references(() => profiles.id, { onDelete: 'set null' }),
    sourceEventId: uuid('source_event_id').references(() => emailWebhookEvents.id, {
      onDelete: 'set null',
    }),
    createdAt: timestamptz('created_at').defaultNow().notNull(),
    resolvedAt: timestamptz('resolved_at'),
    resolvedBy: text('resolved_by').references(() => users.userId, { onDelete: 'restrict' }),
    resolutionNote: text('resolution_note'),
  },
  (table) => [
    uniqueIndex('uq_email_correction_open_address')
      .on(table.address)
      .where(sql`${table.resolvedAt} IS NULL`),
    index('idx_email_correction_created').on(table.createdAt, table.id),
    check(
      'email_correction_resolution',
      sql`(${table.resolvedAt} IS NULL AND ${table.resolvedBy} IS NULL AND ${table.resolutionNote} IS NULL) OR (${table.resolvedAt} IS NOT NULL AND ${table.resolvedBy} IS NOT NULL AND ${table.resolutionNote} IS NOT NULL AND length(btrim(${table.resolutionNote})) BETWEEN 1 AND 2000)`
    ),
  ]
);
