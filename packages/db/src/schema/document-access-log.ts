import { sql } from 'drizzle-orm';
import { check, index, pgTable, text, uuid } from 'drizzle-orm/pg-core';
import { timestamptz, uuidv7 } from '../types.js';
import { documents } from './documents.js';
import { users } from './users.js';

/** Append-only record of an authorized URL issuance, not a claim that bytes were fetched. */
export const documentAccessLog = pgTable(
  'document_access_log',
  {
    id: uuidv7('id').primaryKey().notNull(),
    documentId: uuid('document_id')
      .notNull()
      .references(() => documents.id, { onDelete: 'restrict' }),
    accessedBy: text('accessed_by')
      .notNull()
      .references(() => users.userId, { onDelete: 'restrict' }),
    accessedByType: text('accessed_by_type', { enum: ['customer', 'staff'] }).notNull(),
    action: text('action', { enum: ['download', 'view'] }).notNull(),
    ipAddress: text('ip_address').notNull(),
    userAgent: text('user_agent').notNull(),
    createdAt: timestamptz('created_at').notNull().defaultNow(),
  },
  (table) => [
    index('document_access_log_document_created_idx').on(table.documentId, table.createdAt),
    index('document_access_log_actor_created_idx').on(table.accessedBy, table.createdAt),
    check('document_access_log_actor_type', sql`${table.accessedByType} IN ('customer','staff')`),
    check('document_access_log_action', sql`${table.action} IN ('download','view')`),
    check(
      'document_access_log_request_bounds',
      sql`length(${table.ipAddress}) <= 64 AND length(${table.userAgent}) <= 1024`
    ),
  ]
);

export type DocumentAccessLog = typeof documentAccessLog.$inferSelect;
export type NewDocumentAccessLog = typeof documentAccessLog.$inferInsert;
