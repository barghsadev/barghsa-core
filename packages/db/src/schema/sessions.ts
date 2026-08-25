import { sql } from 'drizzle-orm'
import { pgTable, text, boolean, timestamp } from 'drizzle-orm/pg-core'

/**
 * Sessions table (T-01.02.03 / T-02.02.01).
 *
 * Created on successful authentication (registration OTP verify, login).
 * Stores server-side session state.
 *
 * - `session_id` — opaque UUIDv7, stored in an HttpOnly cookie.
 * - `user_id` — FK to users.user_id.
 * - `csrf_token` — CSRF token bound to this session, rotated on auth events.
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
 * SQL to create the sessions table.
 */
export const createSessionsTable = sql`
  CREATE TABLE IF NOT EXISTS sessions (
    session_id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
    csrf_token TEXT NOT NULL,
    expires_at TIMESTAMPTZ NOT NULL,
    idle_deadline TIMESTAMPTZ NOT NULL,
    revoked_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );

  CREATE INDEX IF NOT EXISTS idx_sessions_user_id ON sessions (user_id);
  CREATE INDEX IF NOT EXISTS idx_sessions_expires_at ON sessions (expires_at);
`