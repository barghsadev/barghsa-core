import { sql } from 'drizzle-orm'
import { integer, pgTable, text, timestamp } from 'drizzle-orm/pg-core'

/**
 * OTP challenge table.
 *
 * Stores one-time password challenges for email/phone verification during
 * registration and login flows (E-02, E-01).
 *
 * - `challenge_id` — opaque UUIDv7 identifying this challenge, returned to
 *   the client so they can submit the OTP they received.
 * - `destination` — the email or E.164 phone the OTP was sent to (never
 *   returned in API responses except DEV console).
 * - `otp_hash` — SHA-256 hash of the 6-digit code. Plaintext OTP is never
 *   stored, never logged, never returned (except DEV console printing).
 * - `attempts_remaining` — max attempts (default 5) decremented on each
 *   failed verify. Reaches 0 → challenge invalidated.
 * - `resend_count` — number of resends for this challenge.
 * - `expires_at` — deadline after which the challenge is invalid.
 *   Default 5 minutes from creation.
 * - `consumed_at` — set when the OTP is successfully verified (single-use).
 *   Any further verify call with this challengeId returns failure.
 * - `created_at` / `updated_at` — base audit columns.
 */
export const otpChallenges = pgTable(
  'otp_challenges',
  {
    /** Opaque challenge ID (UUIDv7) identifying this OTP verification flow. */
    challengeId: text('challenge_id').primaryKey(),

    /** The destination (email or E.164 phone) the OTP was sent to. */
    destination: text('destination').notNull(),

    /** SHA-256 hash of the 6-digit OTP. Never store plaintext. */
    otpHash: text('otp_hash').notNull(),

    /** Remaining verification attempts before the challenge is invalidated. */
    attemptsRemaining: integer('attempts_remaining').notNull().default(5),

    /** Number of resends triggered for this challenge. */
    resendCount: integer('resend_count').notNull().default(0),

    /** Expiration deadline — default 5 min from creation. */
    expiresAt: timestamp('expires_at', { withTimezone: true, mode: 'date' }).notNull(),

    /** Null until the OTP is successfully verified (single-use enforcement). */
    consumedAt: timestamp('consumed_at', { withTimezone: true, mode: 'date' }),

    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' })
      .defaultNow()
      .notNull(),

    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' })
      .defaultNow()
      .notNull(),
  },
)

/**
 * SQL to create the otp_challenges table.
 */
export const createOtpChallengesTable = sql`
  CREATE TABLE IF NOT EXISTS otp_challenges (
    challenge_id TEXT PRIMARY KEY,
    destination TEXT NOT NULL,
    otp_hash TEXT NOT NULL,
    attempts_remaining INTEGER NOT NULL DEFAULT 5,
    resend_count INTEGER NOT NULL DEFAULT 0,
    expires_at TIMESTAMPTZ NOT NULL,
    consumed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );

  CREATE INDEX IF NOT EXISTS idx_otp_challenges_destination
    ON otp_challenges (destination);
`