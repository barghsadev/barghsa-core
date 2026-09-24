import { sql } from 'drizzle-orm';
import { check, index, pgTable, text, boolean, uuid } from 'drizzle-orm/pg-core';
import { timestamptz, uuidv7 } from '../types';
import { bankReceipts, BANK_RECEIPT_STATES } from './bank-receipts';

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
  })
);
