import { sql } from 'drizzle-orm'
import { text, timestamp, pgTable } from 'drizzle-orm/pg-core'
import { uuidv7 } from '../types'
import { users } from './users'
import { profiles } from './profiles'

/**
 * Tickets table (T-06.01.01).
 *
 * Stores support tickets created by users. Each ticket is scoped to a
 * specific user profile. Tickets can optionally reference a related entity
 * (order, contract, invoice) and include file attachments (uploaded via
 * the upload module, then linked by storage key).
 *
 * - `id` — UUIDv7 primary key.
 * - `user_id` — foreign key to the creating user.
 * - `subject` — short ticket subject line.
 * - `body` — full ticket description.
 * - `profile_id` — FK to the profile the ticket is about.
 * - `related_entity_type` — optional discriminator: 'order', 'contract', 'invoice'.
 * - `related_entity_id` — optional UUID of the related entity.
 * - `priority` — 'normal' | 'high'. Default: 'normal'.
 * - `status` — lifecycle: 'open' | 'in_progress' | 'waiting_customer' | 'waiting_staff' | 'resolved' | 'closed'. Default: 'open'.
 * - `created_at` / `updated_at` — audit columns.
 */
export const tickets = pgTable(
  'tickets',
  {
    /** UUIDv7 opaque ticket identifier. */
    id: uuidv7('id').primaryKey().notNull(),

    /** Foreign key to the creating user. */
    userId: text('user_id')
      .notNull()
      .references(() => users.userId, { onDelete: 'cascade' }),

    /** Short ticket subject line. */
    subject: text('subject').notNull(),

    /** Full ticket description body. */
    body: text('body').notNull(),

    /** Optional FK to the profile this ticket relates to. */
    profileId: text('profile_id')
      .references(() => profiles.id, { onDelete: 'set null' }),

    /** Optional related entity type discriminator. */
    relatedEntityType: text('related_entity_type', {
      enum: ['order', 'contract', 'invoice'],
    }),

    /** Optional related entity UUID. */
    relatedEntityId: text('related_entity_id'),

    /** Ticket priority. */
    priority: text('priority', {
      enum: ['normal', 'high'],
    })
      .notNull()
      .default('normal'),

    /** Which staff member is assigned to this ticket (nullable). */
    assignedTo: text('assigned_to')
      .references(() => users.userId, { onDelete: 'set null' }),

    /** Ticket lifecycle status. */
    status: text('status', {
      enum: ['open', 'in_progress', 'waiting_customer', 'waiting_staff', 'resolved', 'closed'],
    })
      .notNull()
      .default('open'),

    /** When the ticket was created. */
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
 * SQL to create the tickets table.
 */
export const createTicketsTable = sql`
  CREATE TABLE IF NOT EXISTS tickets (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v7(),
    user_id TEXT NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
    subject TEXT NOT NULL,
    body TEXT NOT NULL,
    profile_id UUID REFERENCES profiles(id) ON DELETE SET NULL,
    related_entity_type TEXT CHECK (related_entity_type IN ('order', 'contract', 'invoice')),
    related_entity_id TEXT,
    priority TEXT NOT NULL DEFAULT 'normal' CHECK (priority IN ('normal', 'high')),
    status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'in_progress', 'waiting_customer', 'waiting_staff', 'resolved', 'closed')),
    assigned_to UUID REFERENCES users(user_id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );

  CREATE INDEX IF NOT EXISTS idx_tickets_user_id ON tickets (user_id);
  CREATE INDEX IF NOT EXISTS idx_tickets_profile_id ON tickets (profile_id);
  CREATE INDEX IF NOT EXISTS idx_tickets_status ON tickets (status);
  CREATE INDEX IF NOT EXISTS idx_tickets_priority ON tickets (priority);
`