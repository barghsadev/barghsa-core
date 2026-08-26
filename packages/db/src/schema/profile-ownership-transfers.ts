import { sql } from 'drizzle-orm'
import { text, pgTable, timestamp } from 'drizzle-orm/pg-core'
import { uuidv7 } from '../types'
import { profiles } from './profiles'
import { users } from './users'

/**
 * Profile ownership transfers table (T-05.04.05).
 *
 * Tracks pending ownership transfers for legal profiles. When a profile
 * owner initiates a transfer, a pending record is created. The new owner
 * (who must be an existing agent of the profile) must accept within the
 * expiry window. During the transfer, the current owner retains full
 * control.
 *
 * - `id` — UUIDv7 primary key.
 * - `profile_id` — FK to the legal profile being transferred.
 * - `from_user_id` — the current profile owner initiating the transfer.
 * - `to_user_id` — the target user (must be an existing agent).
 * - `status` — 'Pending' | 'Completed' | 'Declined' | 'Expired' | 'Cancelled'.
 * - `expires_at` — timestamp after which the pending transfer auto-expires.
 * - `completed_at` — when the transfer was accepted and completed.
 * - `cancelled_at` — when the transfer was cancelled by the initiator.
 * - `declined_at` — when the transfer was declined by the target.
 * - `created_at` / `updated_at` — audit columns.
 */
export const profileOwnershipTransfers = pgTable(
  'profile_ownership_transfers',
  {
    /** UUIDv7 primary key. */
    id: uuidv7('id').primaryKey().notNull(),

    /** FK to the legal profile being transferred. */
    profileId: text('profile_id')
      .notNull()
      .references(() => profiles.id, { onDelete: 'cascade' }),

    /** The current profile owner initiating the transfer. */
    fromUserId: text('from_user_id')
      .notNull()
      .references(() => users.userId, { onDelete: 'restrict' }),

    /** The target user (must be an existing agent of the profile). */
    toUserId: text('to_user_id')
      .notNull()
      .references(() => users.userId, { onDelete: 'restrict' }),

    /** Transfer status. */
    status: text('status', {
      enum: ['Pending', 'Completed', 'Declined', 'Expired', 'Cancelled'],
    })
      .notNull()
      .default('Pending'),

    /** When the pending transfer expires. */
    expiresAt: timestamp('expires_at', { withTimezone: true, mode: 'date' })
      .notNull(),

    /** When the transfer was accepted and completed. */
    completedAt: timestamp('completed_at', { withTimezone: true, mode: 'date' }),

    /** When the transfer was cancelled by the initiator. */
    cancelledAt: timestamp('cancelled_at', { withTimezone: true, mode: 'date' }),

    /** When the transfer was declined by the target. */
    declinedAt: timestamp('declined_at', { withTimezone: true, mode: 'date' }),

    /** When the record was created. */
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
 * SQL to create the profile_ownership_transfers table.
 *
 * Enforces a single pending transfer per profile via a partial unique
 * index (ONLY rows with status = 'Pending' are constrained).
 */
export const createProfileOwnershipTransfersTable = sql`
  CREATE TABLE IF NOT EXISTS profile_ownership_transfers (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v7(),
    profile_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    from_user_id TEXT NOT NULL REFERENCES users(user_id) ON DELETE RESTRICT,
    to_user_id TEXT NOT NULL REFERENCES users(user_id) ON DELETE RESTRICT,
    status TEXT NOT NULL DEFAULT 'Pending' CHECK (status IN ('Pending', 'Completed', 'Declined', 'Expired', 'Cancelled')),
    expires_at TIMESTAMPTZ NOT NULL,
    completed_at TIMESTAMPTZ,
    cancelled_at TIMESTAMPTZ,
    declined_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );

  CREATE UNIQUE INDEX IF NOT EXISTS idx_ownership_transfers_pending_profile
    ON profile_ownership_transfers (profile_id) WHERE status = 'Pending';

  CREATE INDEX IF NOT EXISTS idx_ownership_transfers_to_user
    ON profile_ownership_transfers (to_user_id);

  CREATE INDEX IF NOT EXISTS idx_ownership_transfers_status
    ON profile_ownership_transfers (status);
`