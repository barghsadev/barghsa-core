import { sql } from 'drizzle-orm'
import { text, timestamp, pgTable } from 'drizzle-orm/pg-core'
import { uuidv7 } from '../types'
import { tickets } from './tickets'
import { users } from './users'

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
    ticketId: text('ticket_id')
      .notNull()
      .references(() => tickets.id, { onDelete: 'cascade' }),

    /** Foreign key to the comment author. */
    authorId: text('author_id')
      .notNull()
      .references(() => users.userId, { onDelete: 'cascade' }),

    /** Comment body text. */
    body: text('body').notNull(),

    /** Visibility: 'public' (customer-visible) or 'internal' (staff-only). */
    visibility: text('visibility', {
      enum: ['public', 'internal'],
    })
      .notNull()
      .default('public'),

    /** When the comment was created. */
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' })
      .defaultNow()
      .notNull(),

    /** Last update timestamp. */
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' })
      .defaultNow()
      .notNull(),
  },
)

/**
 * SQL to create the ticket_comments table.
 */
export const createTicketCommentsTable = sql`
  CREATE TABLE IF NOT EXISTS ticket_comments (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v7(),
    ticket_id TEXT NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
    author_id TEXT NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
    body TEXT NOT NULL,
    visibility TEXT NOT NULL DEFAULT 'public' CHECK (visibility IN ('public', 'internal')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );

  CREATE INDEX IF NOT EXISTS idx_ticket_comments_ticket_id ON ticket_comments (ticket_id);
  CREATE INDEX IF NOT EXISTS idx_ticket_comments_author_id ON ticket_comments (author_id);
  CREATE INDEX IF NOT EXISTS idx_ticket_comments_visibility ON ticket_comments (visibility);
`