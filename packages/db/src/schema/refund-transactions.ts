import { sql } from 'drizzle-orm';
import { check, pgEnum, pgTable, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { baseColumns } from '../base-table';
import { timestamptz } from '../types';
import { refunds } from './refunds';
import { walletTransactions } from './wallets';

export const refundTransactionState = pgEnum('refund_transaction_state', [
  'Pending',
  'Completed',
  'Rejected',
  'Cancelled',
]);

/** Approval-time financial intent for either destination. Amount, profile and
 * destination come from the immutable parent refund. Pending does not affect
 * wallet balances; completion links the actual credit only for wallet refunds.
 * Production triggers own creation and lifecycle updates. */
export const refundTransactions = pgTable(
  'refund_transactions',
  {
    ...baseColumns,
    refundId: uuid('refund_id')
      .notNull()
      .references(() => refunds.id, { onDelete: 'restrict' }),
    state: refundTransactionState('state').notNull().default('Pending'),
    walletTransactionId: uuid('wallet_transaction_id').references(() => walletTransactions.id, {
      onDelete: 'restrict',
    }),
    finishedAt: timestamptz('finished_at'),
  },
  (t) => [
    uniqueIndex('refund_transactions_refund_unique').on(t.refundId),
    uniqueIndex('refund_transactions_credit_unique').on(t.walletTransactionId),
    check(
      'refund_transactions_finished',
      sql`(${t.state} = 'Pending') = (${t.finishedAt} IS NULL)`
    ),
    check(
      'refund_transactions_credit_completed',
      sql`${t.walletTransactionId} IS NULL OR ${t.state} = 'Completed'`
    ),
  ]
);

export type RefundTransaction = typeof refundTransactions.$inferSelect;
export type NewRefundTransaction = typeof refundTransactions.$inferInsert;
