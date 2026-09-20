import { sql } from 'drizzle-orm';
import { pgTable, uuid, text, integer, index, check } from 'drizzle-orm/pg-core';
import { timestamptz } from '../types';
import { refunds } from './refunds';
import { users } from './users';

/** One durable, bounded processing request per manual wallet refund. */
export const refundRetryJobs = pgTable(
  'refund_retry_jobs',
  {
    refundId: uuid('refund_id')
      .primaryKey()
      .references(() => refunds.id, { onDelete: 'restrict' }),
    executorUserId: text('executor_user_id')
      .notNull()
      .references(() => users.userId, { onDelete: 'restrict' }),
    attempts: integer('attempts').notNull().default(0),
    maxAttempts: integer('max_attempts').notNull().default(5),
    nextAttemptAt: timestamptz('next_attempt_at').defaultNow(),
    lastErrorCode: text('last_error_code'),
    exhaustedAt: timestamptz('exhausted_at'),
    completedAt: timestamptz('completed_at'),
    createdAt: timestamptz('created_at').notNull().defaultNow(),
    updatedAt: timestamptz('updated_at')
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [
    index('refund_retry_jobs_due_idx')
      .on(t.nextAttemptAt, t.refundId)
      .where(sql`${t.nextAttemptAt} IS NOT NULL`),
    check(
      'refund_retry_jobs_attempts',
      sql`${t.maxAttempts} BETWEEN 1 AND 20 AND ${t.attempts} BETWEEN 0 AND ${t.maxAttempts}`
    ),
    check(
      'refund_retry_jobs_terminal',
      sql`NOT (${t.completedAt} IS NOT NULL AND ${t.exhaustedAt} IS NOT NULL) AND ((${t.completedAt} IS NULL AND ${t.exhaustedAt} IS NULL) = (${t.nextAttemptAt} IS NOT NULL)) AND (${t.exhaustedAt} IS NULL OR ${t.attempts} = ${t.maxAttempts})`
    ),
  ]
);
export type RefundRetryJob = typeof refundRetryJobs.$inferSelect;
