import { sql } from 'drizzle-orm'
import { text, pgTable, timestamp } from 'drizzle-orm/pg-core'
import { uuidv7 } from '../types'
import { profiles } from './profiles'

/**
 * Profile invitations table (T-05.04.01 / T-05.04.02).
 *
 * Tracks pending invitations for a legal profile. When an owner or manager
 * invites a user (by username), a record is created here. The invite is
 * resolved (Accepted, Declined, Withdrawn, or Expired) through subsequent
 * actions.
 *
 * - `id` — UUIDv7 primary key.
 * - `profile_id` — FK to the legal profile.
 * - `username` — The invited user's email or E.164 phone.
 * - `role` — Intended agent role: Manager, Finance, Legal.
 * - `invited_by` — The user who created the invitation.
 * - `status` — Pending | Accepted | Withdrawn | Declined | Expired.
 * - `expires_at` — Default 7 days from creation.
 * - `created_at` / `updated_at` — audit columns.
 */
export const profileInvitations = pgTable(
  'profile_invitations',
  {
    /** UUIDv7 primary key. */
    id: uuidv7('id').primaryKey().notNull(),

    /** FK to the legal profile. */
    profileId: text('profile_id')
      .notNull()
      .references(() => profiles.id, { onDelete: 'cascade' }),

    /** Invited user's email or E.164 phone. */
    username: text('username').notNull(),

    /** Intended role: Manager, Finance, Legal. */
    role: text('role').notNull(),

    /** User id of the person who sent the invitation. */
    invitedBy: text('invited_by').notNull(),

    /** Invitation lifecycle status. */
    status: text('status', {
      enum: ['Pending', 'Accepted', 'Withdrawn', 'Declined', 'Expired'],
    })
      .notNull()
      .default('Pending'),

    /** When the invitation expires (default 7 days). */
    expiresAt: timestamp('expires_at', { withTimezone: true, mode: 'date' }),

    /** When the invitation was created. */
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
 * SQL to create the profile_invitations table.
 */
export const createProfileInvitationsTable = sql`
  CREATE TABLE IF NOT EXISTS profile_invitations (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v7(),
    profile_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    username TEXT NOT NULL,
    role TEXT NOT NULL,
    invited_by TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'Pending' CHECK (status IN ('Pending', 'Accepted', 'Withdrawn', 'Declined', 'Expired')),
    expires_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );

  CREATE INDEX IF NOT EXISTS idx_profile_invitations_profile
    ON profile_invitations (profile_id);

  CREATE INDEX IF NOT EXISTS idx_profile_invitations_status
    ON profile_invitations (status);
`