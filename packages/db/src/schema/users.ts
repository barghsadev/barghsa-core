import { sql } from 'drizzle-orm'
import { pgTable, text, boolean, timestamp } from 'drizzle-orm/pg-core'

/**
 * Users table (T-01.02.03).
 *
 * Created atomically with OTP consumption during registration verification.
 * Each user has a unique username (email or E.164 phone) that serves as their
 * login identifier.
 *
 * - `user_id` — UUIDv7 primary key, opaque.
 * - `username` — primary login identifier (email or E.164 phone). Normalized, unique, stable.
 * - `email` — email address when username is a mobile (or same as username when username is email). Nullable.
 * - `mobile` — E.164 phone number when username is email (or same as username when username is mobile). Nullable.
 * - `password_hash` — Argon2id hash. Set during registration; managed by
 *   T-02.01.02 (login) and T-02.03.02 (password reset).
 * - `locale` — preferred locale ('fa' | 'en'). Default 'fa'.
 * - `must_change_password` — staff-enforced flag (T-02.01.04).
 * - `is_admin` — admin flag for bootstrap and initial admin user (T-02.04.03).
 * - `last_accepted_tos_version` — current accepted TOS version (T-04.01.03).
 * - `created_at` / `updated_at` — audit columns.
 */
export const users = pgTable(
  'users',
  {
    /** UUIDv7 opaque user identifier. */
    userId: text('user_id').primaryKey(),

    /** Unique username: normalized email or E.164 phone. */
    username: text('username').notNull().unique(),

    /** Email address. Set when username is mobile; same as username when username is email. */
    email: text('email'),

    /** E.164 phone number. Set when username is email; same as username when username is mobile. */
    mobile: text('mobile'),

    /** Argon2id hash of the user's password. */
    passwordHash: text('password_hash').notNull(),

    /** Preferred locale: 'fa' or 'en'. Defaults to Persian. */
    locale: text('locale').notNull().default('fa'),

    /** Staff flag — next login must change password (T-02.01.04). */
    mustChangePassword: boolean('must_change_password').notNull().default(false),

    /** Short-lived token authorizing a password change after login detection (T-02.01.04). */
    passwordChangeToken: text('password_change_token'),

    /** Expiry of the password change token (default 5 min). */
    passwordChangeTokenExpiresAt: timestamp('password_change_token_expires_at', { withTimezone: true, mode: 'date' }),

    /** Notification channel preferences (T-03.03.05). */
    notificationPreferences: text('notification_preferences').notNull().default('IN_APP'),

    /** IANA timezone string (T-03.03.06). Default: Iran Standard Time (UTC+3:30). */
    timezone: text('timezone').notNull().default('Asia/Tehran'),

    /** Admin flag — set for bootstrap admin user (T-02.04.03). */
    isAdmin: boolean('is_admin').notNull().default(false),

    /** Time-limited activation token for staff user 'link' activation method (T-05.03.01). */
    activationToken: text('activation_token'),

    /** Expiry of the activation token (24h from creation, T-05.03.01). */
    activationTokenExpiresAt: timestamp('activation_token_expires_at', { withTimezone: true, mode: 'date' }),

    /** Version ID of the TOS the user last accepted (T-04.01.03). */
    lastAcceptedTosVersion: text('last_accepted_tos_version'),

    /** When the user was created (registration verified). */
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
 * SQL to create the users table.
 */
export const createUsersTable = sql`
  CREATE TABLE IF NOT EXISTS users (
    user_id TEXT PRIMARY KEY,
    username TEXT NOT NULL UNIQUE,
    email TEXT,
    mobile TEXT,
    password_hash TEXT NOT NULL,
    locale TEXT NOT NULL DEFAULT 'fa',
    must_change_password BOOLEAN NOT NULL DEFAULT false,
    is_admin BOOLEAN NOT NULL DEFAULT false,
    last_accepted_tos_version TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );

  CREATE INDEX IF NOT EXISTS idx_users_username ON users (username);

  -- Migration: add email and mobile columns for T-03.03.04
  DO $$ BEGIN
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_name = 'users' AND column_name = 'email'
    ) THEN
      ALTER TABLE users ADD COLUMN email TEXT;
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_name = 'users' AND column_name = 'mobile'
    ) THEN
      ALTER TABLE users ADD COLUMN mobile TEXT;
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_name = 'users' AND column_name = 'notification_preferences'
    ) THEN
      ALTER TABLE users ADD COLUMN notification_preferences TEXT NOT NULL DEFAULT 'IN_APP';
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_name = 'users' AND column_name = 'timezone'
    ) THEN
      ALTER TABLE users ADD COLUMN timezone TEXT NOT NULL DEFAULT 'Asia/Tehran';
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_name = 'users' AND column_name = 'activation_token'
    ) THEN
      ALTER TABLE users ADD COLUMN activation_token TEXT;
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_name = 'users' AND column_name = 'activation_token_expires_at'
    ) THEN
      ALTER TABLE users ADD COLUMN activation_token_expires_at TIMESTAMPTZ;
    END IF;
  END $$;
`