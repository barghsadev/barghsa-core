import { sql } from 'drizzle-orm';
import {
  check,
  foreignKey,
  index,
  pgEnum,
  pgTable,
  text,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { baseColumns } from '../base-table';
import { irrAmount } from '../types';
import { invoices } from './invoices';
import { users } from './users';

export const refundState = pgEnum('refund_state', [
  'Requested',
  'Approved',
  'Processing',
  'Completed',
  'Failed',
  'Rejected',
  'Cancelled',
]);
export const refundDestination = pgEnum('refund_destination', ['wallet', 'external_bank']);
export const refundReconciliationStatus = pgEnum('refund_reconciliation_status', [
  'Pending',
  'Confirmed',
]);

/**
 * Durable refund requests. Pending/failed requests reserve refundable funds.
 * Migration triggers serialize reservations on the invoice, retain history,
 * and increment invoices.refunded_amount exactly once on completion.
 * Future processors must complete the ledger transfer in the same transaction
 * and must not increment that counter themselves.
 */
export const refunds = pgTable(
  'refunds',
  {
    ...baseColumns,
    invoiceId: uuid('invoice_id').notNull(),
    profileId: uuid('profile_id').notNull(),
    amount: irrAmount('amount').notNull(),
    state: refundState('state').notNull().default('Requested'),
    destination: refundDestination('destination').notNull(),
    // NULL represents a system-created obligation, not an anonymous staff action.
    staffId: text('staff_id').references(() => users.userId, { onDelete: 'restrict' }),
    idempotencyKey: text('idempotency_key').notNull(),
    bankReference: text('bank_reference'),
    reconciliationStatus: refundReconciliationStatus('reconciliation_status'),
  },
  (table) => ({
    invoiceProfile: foreignKey({
      name: 'refunds_invoice_profile_fk',
      columns: [table.invoiceId, table.profileId],
      foreignColumns: [invoices.id, invoices.profileId],
    }).onDelete('restrict'),
    idempotency: uniqueIndex('refunds_idempotency_key_unique').on(table.idempotencyKey),
    invoice: index('refunds_invoice_id_idx').on(table.invoiceId),
    profile: index('refunds_profile_created_idx').on(table.profileId, table.createdAt, table.id),
    state: index('refunds_state_created_idx').on(table.state, table.createdAt),
    positiveAmount: check('refunds_amount_positive', sql`${table.amount} > 0`),
    keyNonblank: check(
      'refunds_idempotency_key_nonblank',
      sql`length(trim(${table.idempotencyKey})) > 0`
    ),
    bankReferenceNonblank: check(
      'refunds_bank_reference_nonblank',
      sql`${table.bankReference} IS NULL OR length(trim(${table.bankReference})) > 0`
    ),
    destinationFields: check(
      'refunds_destination_fields',
      sql`${table.destination} = 'external_bank' OR (${table.bankReference} IS NULL AND ${table.reconciliationStatus} IS NULL)`
    ),
    reconciledReference: check(
      'refunds_reconciled_reference',
      sql`${table.reconciliationStatus} IS DISTINCT FROM 'Confirmed' OR ${table.bankReference} IS NOT NULL`
    ),
    completedExternal: check(
      'refunds_completed_external',
      sql`${table.state} <> 'Completed' OR ${table.destination} <> 'external_bank' OR (${table.bankReference} IS NOT NULL AND ${table.reconciliationStatus} IS NOT DISTINCT FROM 'Confirmed')`
    ),
  })
);

export type Refund = typeof refunds.$inferSelect;
export type NewRefund = typeof refunds.$inferInsert;
