import { sql } from 'drizzle-orm'
import { text, boolean, pgTable, timestamp } from 'drizzle-orm/pg-core'
import { uuidv7 } from '../types'
import { users } from './users'

/**
 * User profiles table (T-03.01.01).
 *
 * Each user can have one or more profiles (Individual or Legal). After login,
 * the app-level profile check middleware (T-03.01.01) verifies profile existence
 * and redirects accordingly.
 *
 * - `id` — UUIDv7 primary key.
 * - `user_id` — foreign key to users table, cascading delete.
 * - `profile_type` — 'INDIVIDUAL' or 'LEGAL'.
 * - `is_default` — whether this is the user's default/active profile.
 * - `status` — 'DRAFT' | 'ACTIVE' | 'VERIFIED' | 'SUSPENDED'.
 * - `title` — optional honorific (Dr., Mr., etc.).
 * - `first_name` / `last_name` — profile display name.
 * - `created_at` / `updated_at` — audit columns.
 */
export const profiles = pgTable(
  'profiles',
  {
    /** UUIDv7 opaque profile identifier. */
    id: uuidv7('id').primaryKey().notNull(),

    /** Foreign key to the owning user. */
    userId: text('user_id')
      .notNull()
      .references(() => users.userId, { onDelete: 'cascade' }),

    /** Profile type: individual or legal entity. */
    profileType: text('profile_type', { enum: ['INDIVIDUAL', 'LEGAL'] })
      .notNull()
      .default('INDIVIDUAL'),

    /** Whether this profile is the user's default. */
    isDefault: boolean('is_default').notNull().default(false),

    /** Profile lifecycle status. */
    status: text('status', { enum: ['DRAFT', 'ACTIVE', 'VERIFIED', 'SUSPENDED'] })
      .notNull()
      .default('DRAFT'),

    /** Optional honorific title. */
    title: text('title'),

    /** First (given) name. */
    firstName: text('first_name'),

    /** Last (family) name. */
    lastName: text('last_name'),

    /** When the profile was created. */
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
 * SQL to create the profiles table.
 *
 * Enforces a single default profile per user via a partial unique index
 * (ONLY rows with is_default = true are constrained).
 */
export const createProfilesTable = sql`
  CREATE TABLE IF NOT EXISTS profiles (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v7(),
    user_id TEXT NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
    profile_type TEXT NOT NULL DEFAULT 'INDIVIDUAL' CHECK (profile_type IN ('INDIVIDUAL', 'LEGAL')),
    is_default BOOLEAN NOT NULL DEFAULT false,
    status TEXT NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT', 'ACTIVE', 'VERIFIED', 'SUSPENDED')),
    title TEXT,
    first_name TEXT,
    last_name TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );

  CREATE INDEX IF NOT EXISTS idx_profiles_user_id ON profiles (user_id);
  CREATE UNIQUE INDEX IF NOT EXISTS idx_profiles_default_per_user ON profiles (user_id) WHERE is_default = true;
`
