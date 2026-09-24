import { sql } from 'drizzle-orm';
import { check, index, integer, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { documents } from './documents.js';

export const documentScanJobs = pgTable(
  'document_scan_jobs',
  {
    documentId: uuid('document_id')
      .primaryKey()
      .references(() => documents.id, { onDelete: 'restrict' }),
    attempts: integer('attempts').notNull().default(0),
    nextAttemptAt: timestamp('next_attempt_at', { withTimezone: true }).notNull().defaultNow(),
    lastError: text('last_error'),
    verdict: text('verdict'),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('document_scan_jobs_due_idx').on(table.completedAt, table.nextAttemptAt),
    check('document_scan_jobs_attempts', sql`${table.attempts} >= 0`),
    check(
      'document_scan_jobs_verdict',
      sql`(${table.verdict} IS NULL AND ${table.completedAt} IS NULL) OR (${table.verdict} IN ('clean','infected') AND ${table.completedAt} IS NOT NULL)`
    ),
  ]
);
