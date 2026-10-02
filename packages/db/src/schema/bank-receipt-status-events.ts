import { sql } from 'drizzle-orm';
import { check, index, pgTable, text, boolean, uuid } from 'drizzle-orm/pg-core';
import { timestamptz, uuidv7 } from '../types';
import { bankReceipts, BANK_RECEIPT_STATES } from './bank-receipts';
import { users } from './users';

/** Immutable receipt state history, written by the database on every transition. */
export const bankReceiptStatusEvents = pgTable(
  'bank_receipt_status_events',
  {
    id: uuidv7('id').primaryKey(),
    receiptId: uuid('receipt_id')
      .notNull()
      .references(() => bankReceipts.id, { onDelete: 'cascade' }),
    state: text('state', { enum: BANK_RECEIPT_STATES }).notNull(),
    occurredAt: timestamptz('occurred_at').notNull(),
    /** Older rows reconstructed from the receipt's current state. */
    backfilled: boolean('backfilled').notNull().default(false),
    actorUserId: text('actor_user_id').references(() => users.userId, { onDelete: 'set null' }),
    actorType: text('actor_type', { enum: ['customer', 'staff', 'unknown'] })
      .notNull()
      .default('unknown'),
    reason: text('reason'),
  },
  (table) => ({
    stateCheck: check(
      'chk_bank_receipt_status_events_state',
      sql`${table.state} IN ('Submitted', 'UnderReview', 'Confirmed', 'Rejected')`
    ),
    receiptTimeIdx: index('idx_bank_receipt_status_events_receipt_time').on(
      table.receiptId,
      table.occurredAt,
      table.id
    ),
    actorTypeCheck: check(
      'chk_receipt_status_actor_type',
      sql`${table.actorType} IN ('customer', 'staff', 'unknown')`
    ),
    actorCheck: check(
      'chk_receipt_status_actor',
      sql`${table.actorType} <> 'unknown' OR ${table.actorUserId} IS NULL`
    ),
    actorIdx: index('idx_receipt_status_actor').on(table.actorUserId),
  })
);
