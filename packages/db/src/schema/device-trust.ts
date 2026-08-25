import { sql } from 'drizzle-orm'
import { pgTable, text, boolean, timestamp, integer } from 'drizzle-orm/pg-core'

/**
 * Device trust table (T-02.01.03).
 *
 * Stores trusted device fingerprints for users who opted to "trust this device"
 * during OTP step-up login. Trusted devices skip risk-based OTP on subsequent
 * logins within the trust period.
 *
 * - `id` — UUIDv7 primary key, opaque.
 * - `user_id` — FK to users.user_id.
 * - `device_fingerprint` — hashed device fingerprint (user agent, IP hint, etc).
 * - `trusted_at` — when the device was trusted.
 * - `expires_at` — when trust expires (default 30 days).
 * - `created_at` / `updated_at` — audit columns.
 */
export const deviceTrusts = pgTable(
  'device_trusts',
  {
    /** UUIDv7 opaque identifier. */
    id: text('id').primaryKey(),

    /** The user who owns this device trust. */
    userId: text('user_id').notNull(),

    /** Hashed device fingerprint for identification. */
    deviceFingerprint: text('device_fingerprint').notNull(),

    /** User-agent hint for display in device management. */
    userAgentHint: text('user_agent_hint'),

    /** When the device was trusted. */
    trustedAt: timestamp('trusted_at', { withTimezone: true, mode: 'date' })
      .defaultNow()
      .notNull(),

    /** When trust expires (default 30 days). */
    expiresAt: timestamp('expires_at', { withTimezone: true, mode: 'date' }).notNull(),

    /** Creation timestamp. */
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
 * SQL to create the device_trusts table.
 */
export const createDeviceTrustsTable = sql`
  CREATE TABLE IF NOT EXISTS device_trusts (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
    device_fingerprint TEXT NOT NULL,
    user_agent_hint TEXT,
    trusted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    expires_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );

  CREATE INDEX IF NOT EXISTS idx_device_trusts_user_id ON device_trusts (user_id);
  CREATE INDEX IF NOT EXISTS idx_device_trusts_fingerprint
    ON device_trusts (user_id, device_fingerprint);

  -- Unique constraint for upsert: one trusted device per user-fingerprint pair
  CREATE UNIQUE INDEX IF NOT EXISTS idx_device_trusts_unique
    ON device_trusts (user_id, device_fingerprint);
`