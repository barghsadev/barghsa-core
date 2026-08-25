import { sql } from 'drizzle-orm'
import { pgTable, text, integer, timestamp } from 'drizzle-orm/pg-core'
import { users } from './users.js'

/**
 * Password history table (T-02.01.04).
 *
 * Stores the last N password hashes per user to prevent password reuse.
 * Each entry records the Argon2id hash, a version counter (incremented on
 * each password change), and the timestamp. The latest N (default 5) are
 * checked when a password change is requested.
 *
 * - `id` — UUIDv7 primary key.
 * - `user_id` — FK to users.user_id.
 * - `password_hash` — Argon2id hash of a previous password.
 * - `version` — monotonic version counter for ordering.
 * - `created_at` — when this password was set.
 */
export const passwordHistory = pgTable(
  'password_history',
  {
    /** UUIDv7 primary key. */
    id: text('id').primaryKey(),

    /** FK to the user whose password history this belongs to. */
    userId: text('user_id')
      .notNull()
      .references(() => users.userId, { onDelete: 'cascade' }),

    /** Argon2id hash of a previous password. */
    passwordHash: text('password_hash').notNull(),

    /** Monotonic version counter (increments on each change). */
    version: integer('version').notNull(),

    /** When this password was originally set. */
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' })
      .defaultNow()
      .notNull(),
  },
)

/**
 * SQL to create the password_history table.
 */
export const createPasswordHistoryTable = sql`
  CREATE TABLE IF NOT EXISTS password_history (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
    password_hash TEXT NOT NULL,
    version INTEGER NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );

  CREATE INDEX IF NOT EXISTS idx_password_history_user_version
    ON password_history (user_id, version DESC);
`