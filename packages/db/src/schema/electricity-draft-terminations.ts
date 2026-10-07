import { check, jsonb, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { electricityOrders } from './electricity-orders';
import { profiles } from './profiles';
import { users } from './users';
import { approvalRequests } from './approval-requests';

/** Immutable authorization for an existing contractless order's financial closure. */
export const electricityDraftTerminations = pgTable(
  'electricity_draft_terminations',
  {
    orderId: uuid('order_id')
      .primaryKey()
      .references(() => electricityOrders.id, { onDelete: 'restrict' }),
    profileId: uuid('profile_id')
      .notNull()
      .references(() => profiles.id, { onDelete: 'restrict' }),
    executedBy: text('executed_by')
      .notNull()
      .references(() => users.userId, { onDelete: 'restrict' }),
    action: text('action', { enum: ['reject', 'cancel'] }).notNull(),
    reason: text('reason').notNull(),
    reviewHash: text('review_hash').notNull(),
    financialReview: jsonb('financial_review').$type<Record<string, unknown>>().notNull(),
    approvalRequestId: uuid('approval_request_id').references(() => approvalRequests.id, {
      onDelete: 'restrict',
    }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check('electricity_draft_termination_action', sql`${t.action} IN ('reject','cancel')`),
    check(
      'electricity_draft_termination_reason',
      sql`length(trim(${t.reason})) BETWEEN 1 AND 1000`
    ),
    check('electricity_draft_termination_hash', sql`${t.reviewHash} ~ '^[0-9a-f]{64}$'`),
    check('electricity_draft_termination_review', sql`jsonb_typeof(${t.financialReview})='object'`),
  ]
);
