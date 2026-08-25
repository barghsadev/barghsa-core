import { sql } from 'drizzle-orm'
import { pgTable, text, timestamp, integer } from 'drizzle-orm/pg-core'

/**
 * Refresh token families (T-02.02.01).
 *
 * Tracks refresh token rotation and detects token reuse.
 * When a refresh token is used, the server issues a new one and records
 * the rotation. If an old (already rotated) token is reused, it signals
 * potential token theft — the entire family is revoked and the user is
 * alerted.
 *
 * - `family_id` — UUIDv7 grouping tokens into families (FK to sessions.family_id).
 * - `token_hash` — SHA-256 hash of the refresh token (consumed on rotation).
 * - `user_id` — FK to users.user_id, for quick family revocation by user.
 * - `session_id` — FK to sessions.session_id, for quick family lookup.
 * - `version` — monotonic version counter (each rotation increments).
 * - `consumed_at` — set when this token is rotated (next token issued).
 * - `created_at` — when this token was issued.
 */
export const refreshTokens = pgTable(
  'refresh_tokens',
  {
    /** Unique record ID (UUIDv7). */
    id: text('id').primaryKey(),

    /** Family ID grouping tokens into revocation families. */
    familyId: text('family_id').notNull(),

    /** SHA-256 hash of the refresh token. */
    tokenHash: text('token_hash').notNull().unique(),

    /** The user this token belongs to. */
    userId: text('user_id').notNull(),

    /** The session this token belongs to. */
    sessionId: text('session_id').notNull(),

    /** Monotonic version counter (1 = original, incremented on rotation). */
    version: integer('version').notNull().default(1),

    /** Set when this token is consumed (rotated) — null means current token. */
    consumedAt: timestamp('consumed_at', { withTimezone: true, mode: 'date' }),

    /** Creation timestamp. */
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' })
      .defaultNow()
      .notNull(),
  },
)

/**
 * SQL to create the refresh_tokens table.
 */
export const createRefreshTokensTable = sql`
  CREATE TABLE IF NOT EXISTS refresh_tokens (
    id TEXT PRIMARY KEY,
    family_id TEXT NOT NULL,
    token_hash TEXT NOT NULL UNIQUE,
    user_id TEXT NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
    session_id TEXT NOT NULL REFERENCES sessions(session_id) ON DELETE CASCADE,
    version INTEGER NOT NULL DEFAULT 1,
    consumed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );

  CREATE INDEX IF NOT EXISTS idx_refresh_tokens_family_id ON refresh_tokens (family_id);
  CREATE INDEX IF NOT EXISTS idx_refresh_tokens_user_id ON refresh_tokens (user_id);
  CREATE INDEX IF NOT EXISTS idx_refresh_tokens_session_id ON refresh_tokens (session_id);
  CREATE INDEX IF NOT EXISTS idx_refresh_tokens_consumed_at ON refresh_tokens (consumed_at);
`