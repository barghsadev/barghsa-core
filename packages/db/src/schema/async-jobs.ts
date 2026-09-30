import { sql } from 'drizzle-orm';
import { check, index, integer, jsonb, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { users } from './users.js';

/** Customer-visible, one-shot work; distinct from the recurring worker failure ledger. */
export const asyncJobs = pgTable(
  'async_jobs',
  {
    id: uuid('id').primaryKey(),
    type: text('type').notNull(),
    status: text('status', { enum: ['queued', 'processing', 'completed', 'failed'] })
      .notNull()
      .default('queued'),
    progressPct: integer('progress_pct').notNull().default(0),
    payload: jsonb('payload').notNull(),
    resultUrl: text('result_url'),
    errorMessage: text('error_message'),
    createdBy: text('created_by')
      .notNull()
      .references(() => users.userId, { onDelete: 'cascade' }),
    operatingContext: text('operating_context', { enum: ['customer', 'staff'] })
      .notNull()
      .default('customer'),
    attempts: integer('attempts').notNull().default(0),
    leaseToken: uuid('lease_token'),
    leaseUntil: timestamp('lease_until', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    startedAt: timestamp('started_at', { withTimezone: true }),
    completedAt: timestamp('completed_at', { withTimezone: true }),
  },
  (t) => [
    index('async_jobs_status_created_idx').on(t.status, t.createdAt),
    index('async_jobs_owner_created_idx').on(t.createdBy, t.createdAt),
    check('async_jobs_status', sql`${t.status} IN ('queued','processing','completed','failed')`),
    check('async_jobs_type', sql`${t.type} ~ '^[a-z][a-z0-9-]{0,63}$'`),
    check('async_jobs_operating_context', sql`${t.operatingContext} IN ('customer','staff')`),
    check('async_jobs_progress', sql`${t.progressPct} BETWEEN 0 AND 100`),
    check('async_jobs_attempts', sql`${t.attempts} BETWEEN 0 AND 3`),
    check(
      'async_jobs_lease',
      sql`(${t.status} = 'processing' AND ${t.leaseToken} IS NOT NULL AND ${t.leaseUntil} IS NOT NULL)
        OR (${t.status} <> 'processing' AND ${t.leaseToken} IS NULL AND ${t.leaseUntil} IS NULL)`
    ),
    check(
      'async_jobs_result',
      sql`${t.resultUrl} IS NULL OR (${t.status} = 'completed' AND left(${t.resultUrl}, 1) = '/' AND left(${t.resultUrl}, 2) <> '//')`
    ),
  ]
);
