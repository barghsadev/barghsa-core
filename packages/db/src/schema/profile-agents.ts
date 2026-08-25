import { sql } from 'drizzle-orm'
import { text, pgTable, timestamp } from 'drizzle-orm/pg-core'
import { uuidv7 } from '../types'
import { profiles } from './profiles'

/**
 * Profile agents table (T-05.04.01).
 *
 * Tracks users who have accepted an agent invitation for a legal profile.
 * Each agent holds a role that determines their permissions within the
 * legal entity's scope.
 *
 * - `id` — UUIDv7 primary key.
 * - `profile_id` — FK to the legal profile (profiles.id).
 * - `user_id` — FK to the registered user.
 * - `role` — Agent role within the legal entity.
 * - `joined_at` — When the invitation was accepted.
 * - `created_at` / `updated_at` — audit columns.
 */
export const profileAgents = pgTable(
  'profile_agents',
  {
    /** UUIDv7 primary key. */
    id: uuidv7('id').primaryKey().notNull(),

    /** FK to the legal profile. */
    profileId: text('profile_id')
      .notNull()
      .references(() => profiles.id, { onDelete: 'cascade' }),

    /** FK to the registered user. */
    userId: text('user_id').notNull(),

    /** Agent role: 'Owner', 'Manager', 'Finance', 'Legal'. */
    role: text('role').notNull(),

    /** When the invitation was accepted and this agent was added. */
    joinedAt: timestamp('joined_at', { withTimezone: true, mode: 'date' })
      .defaultNow()
      .notNull(),

    /** When the agent record was created. */
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
 * SQL to create the profile_agents table.
 *
 * Enforces a unique constraint per profile+user so the same user
 * cannot be added twice to the same legal profile.
 */
export const createProfileAgentsTable = sql`
  CREATE TABLE IF NOT EXISTS profile_agents (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v7(),
    profile_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    user_id TEXT NOT NULL,
    role TEXT NOT NULL,
    joined_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );

  CREATE UNIQUE INDEX IF NOT EXISTS idx_profile_agents_profile_user
    ON profile_agents (profile_id, user_id);

  CREATE INDEX IF NOT EXISTS idx_profile_agents_user
    ON profile_agents (user_id);
`