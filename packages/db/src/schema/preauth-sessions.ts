import { sql } from 'drizzle-orm';
import { check, index, pgTable, text, timestamp } from 'drizzle-orm/pg-core';

/** Anonymous CSRF challenges. Never promoted to authenticated sessions. */
export const preauthSessions = pgTable(
  'preauth_sessions',
  {
    idHash: text('id_hash').primaryKey(),
    csrfToken: text('csrf_token').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  },
  (table) => [
    index('preauth_sessions_expires_idx').on(table.expiresAt),
    check('preauth_sessions_id_hash_check', sql`${table.idHash} ~ '^[a-f0-9]{64}$'`),
    check('preauth_sessions_csrf_check', sql`${table.csrfToken} ~ '^[a-f0-9]{64}$'`),
    check('preauth_sessions_deadline_check', sql`${table.expiresAt} > ${table.createdAt}`),
  ]
);

export type PreauthSession = typeof preauthSessions.$inferSelect;
export type NewPreauthSession = typeof preauthSessions.$inferInsert;
