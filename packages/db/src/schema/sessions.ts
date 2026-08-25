import { sql } from 'drizzle-orm'
import { pgTable, text, boolean, timestamp, jsonb } from 'drizzle-orm/pg-core'

/**
 * Sessions table (T-01.02.03 / T-02.02.01).
 *
 * Created on successful authentication (registration OTP verify, login).
 * Stores server-side session state with refresh token support.
 *
 * - `session_id` — opaque UUIDv7, stored in an HttpOnly cookie.
 * - `user_id` — FK to users.user_id.
 * - `csrf_token` — CSRF token bound to this session, rotated on auth events.
 * - `refresh_token_hash` — SHA-256 hash of the current refresh token (rotation on use).
 * - `family_id` — UUIDv7 grouping refresh tokens into families (reuse revokes family).
 * - `device_info` — JSON metadata about the client device (fingerprint, user-agent).
 * - `expires_at` — absolute session expiry (default 24h from creation).
 * - `idle_deadline` — idle timeout deadline (default 30min from last activity).
 * - `revoked_at` — set when the session is revoked (T-02.02.02).
 * - `created_at` — when the session was created.
 * - `updated_at` — last activity update timestamp.
 */
export const sessions = pgTable(
  'sessions',
  {
    /** Opaque session identifier (UUIDv7). Stored in HttpOnly cookie. */
    sessionId: text('session_id').primaryKey(),

    /** The user this session belongs to. */
    userId: text('user_id').notNull(),

    /** CSRF token bound to this session, rotated on auth events (T-02.02.03). */
    csrfToken: text('csrf_token').notNull(),

    /** SHA-256 hash of the current refresh token (rotated on use). */
    refreshTokenHash: text('refresh_token_hash'),

    /** UUIDv7 grouping refresh tokens into revocation families. */
    familyId: text('family_id'),

    /** JSON metadata about the device (fingerprint, user agent, IP hint). */
    deviceInfo: jsonb('device_info'),

    /** Absolute session expiry (default 24h from creation). */
    expiresAt: timestamp('expires_at', { withTimezone: true, mode: 'date' }).notNull(),

    /** Idle timeout deadline (default 30min from last activity). */
    idleDeadline: timestamp('idle_deadline', { withTimezone: true, mode: 'date' }).notNull(),

    /** Null until the session is explicitly revoked (T-02.02.02). */
    revokedAt: timestamp('revoked_at', { withTimezone: true, mode: 'date' }),

    /** Creation timestamp. */
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' })
      .defaultNow()
      .notNull(),

    /** Last activity update timestamp. */
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' })
      .defaultNow()
      .notNull(),
  },
)

/**
 * SQL to create or migrate the sessions table.
 * Uses IF NOT EXISTS for idempotent initial migration.
 * New columns added via ALTER TABLE for backward-compatible migration.
 */
export const createSessionsTable = sql`
  CREATE TABLE IF NOT EXISTS sessions (
    session_id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
    csrf_token TEXT NOT NULL,
    refresh_token_hash TEXT,
    family_id TEXT,
    device_info JSONB,
    expires_at TIMESTAMPTZ NOT NULL,
    idle_deadline TIMESTAMPTZ NOT NULL,
    revoked_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );

  CREATE INDEX IF NOT EXISTS idx_sessions_user_id ON sessions (user_id);
  CREATE INDEX IF NOT EXISTS idx_sessions_expires_at ON sessions (expires_at);
  CREATE INDEX IF NOT EXISTS idx_sessions_idle_deadline ON sessions (idle_deadline);
  CREATE INDEX IF NOT EXISTS idx_sessions_family_id ON sessions (family_id);
`

/**
 * SQL to add new columns to an existing sessions table (backward-compatible migration).
 */
export const migrateSessionsTable = sql`
  DO $$
  BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'sessions' AND column_name = 'refresh_token_hash') THEN
      ALTER TABLE sessions ADD COLUMN refresh_token_hash TEXT;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'sessions' AND column_name = 'family_id') THEN
      ALTER TABLE sessions ADD COLUMN family_id TEXT;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'sessions' AND column_name = 'device_info') THEN
      ALTER TABLE sessions ADD COLUMN device_info JSONB;
    END IF;
  END $$;
`