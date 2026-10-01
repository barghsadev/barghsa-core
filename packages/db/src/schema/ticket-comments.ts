import { sql } from 'drizzle-orm';
import { uuid, text, timestamp, pgTable, jsonb, check, uniqueIndex } from 'drizzle-orm/pg-core';
import { uuidv7 } from '../types';
import { tickets } from './tickets';
import { users } from './users';

/**
 * Ticket comments table (T-06.01.02).
 *
 * Stores comments on support tickets. Each comment is authored by a user
 * (customer or staff) and has a visibility flag:
 *
 * - `public` — visible to the customer who owns the ticket.
 * - `internal` — staff-only notes, hidden from the customer.
 *
 * Customers see only public comments. Staff can see and add both.
 */
export const ticketComments = pgTable(
  'ticket_comments',
  {
    /** UUIDv7 opaque comment identifier. */
    id: uuidv7('id').primaryKey().notNull(),

    /** Foreign key to the parent ticket. */
    ticketId: uuid('ticket_id')
      .notNull()
      .references(() => tickets.id, { onDelete: 'cascade' }),

    /** Foreign key to the comment author. */
    authorId: text('author_id')
      .notNull()
      .references(() => users.userId, { onDelete: 'cascade' }),

    /** Comment body text. */
    body: text('body').notNull(),
    bodyFormat: text('body_format', { enum: ['plain', 'markdown'] })
      .notNull()
      .default('plain'),
    attachments: jsonb('attachments')
      .$type<string[]>()
      .notNull()
      .default(sql`'[]'::jsonb`),
    authorContext: text('author_context', { enum: ['customer', 'staff', 'unknown'] })
      .notNull()
      .default('unknown'),
    submissionId: uuid('submission_id'),
    submissionHash: text('submission_hash'),

    /** Visibility: 'public' (customer-visible) or 'internal' (staff-only). */
    visibility: text('visibility', {
      enum: ['public', 'internal'],
    })
      .notNull()
      .default('public'),

    /** When the comment was created. */
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).defaultNow().notNull(),

    /** Last update timestamp. */
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
  },
  (table) => [
    check('ticket_comments_body_format_check', sql`${table.bodyFormat} IN ('plain','markdown')`),
    check(
      'ticket_comments_author_context_check',
      sql`${table.authorContext} IN ('customer','staff','unknown')`
    ),
    check(
      'ticket_comments_attachments_check',
      sql`jsonb_typeof(${table.attachments})='array' AND jsonb_array_length(${table.attachments})<=5`
    ),
    check(
      'ticket_comments_submission_check',
      sql`(${table.submissionId} IS NULL AND ${table.submissionHash} IS NULL) OR (${table.submissionId} IS NOT NULL AND ${table.submissionHash} IS NOT NULL AND ${table.submissionHash} ~ '^[a-f0-9]{64}$')`
    ),
    uniqueIndex('ticket_comments_submission_unique')
      .on(table.ticketId, table.authorId, table.submissionId)
      .where(sql`${table.submissionId} IS NOT NULL`),
  ]
);

/**
 * SQL to create the ticket_comments table.
 */
export const createTicketCommentsTable = sql`
  CREATE TABLE IF NOT EXISTS ticket_comments (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v7(),
    ticket_id UUID NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
    author_id TEXT NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
    body TEXT NOT NULL,
    body_format TEXT NOT NULL DEFAULT 'plain' CHECK (body_format IN ('plain','markdown')),
    attachments JSONB NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(attachments)='array' AND jsonb_array_length(attachments)<=5),
    author_context TEXT NOT NULL DEFAULT 'unknown' CHECK (author_context IN ('customer','staff','unknown')),
    submission_id UUID,
    submission_hash TEXT,
    CHECK ((submission_id IS NULL AND submission_hash IS NULL) OR (submission_id IS NOT NULL AND submission_hash IS NOT NULL AND submission_hash ~ '^[a-f0-9]{64}$')),
    visibility TEXT NOT NULL DEFAULT 'public' CHECK (visibility IN ('public', 'internal')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );

  CREATE UNIQUE INDEX IF NOT EXISTS ticket_comments_submission_unique ON ticket_comments(ticket_id,author_id,submission_id) WHERE submission_id IS NOT NULL;
  CREATE INDEX IF NOT EXISTS idx_ticket_comments_ticket_id ON ticket_comments (ticket_id);
  CREATE INDEX IF NOT EXISTS idx_ticket_comments_author_id ON ticket_comments (author_id);
  CREATE INDEX IF NOT EXISTS idx_ticket_comments_visibility ON ticket_comments (visibility);
`;
