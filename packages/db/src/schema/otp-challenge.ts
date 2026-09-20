import { sql } from 'drizzle-orm';
import {
  check,
  integer,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  type AnyPgColumn,
} from 'drizzle-orm/pg-core';

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
 * - `password_hash` — Argon2id hash of the user's password, stored during
 *   registration step for consumption on OTP verify (T-01.02.03).
 * - `tos_version_id` — the TOS version accepted during registration
 *   (T-01.01.04), stored for atomic user creation on OTP verify.
 * - `expires_at` — deadline after which the challenge is invalid.
 *   Default 5 minutes from creation.
 * - `consumed_at` — set when the OTP is successfully verified (single-use).
 *   Any further verify call with this challengeId returns failure.
 * - `user_id` — optional FK to users.user_id, set for login OTP challenges
 *   to link the challenge to an already-authenticated user (T-02.01.03).
 * - `created_at` / `updated_at` — base audit columns.
 */
export const otpChallenges = pgTable(
  'otp_challenges',
  {
    /** Opaque challenge ID (UUIDv7) identifying this OTP verification flow. */
    challengeId: text('challenge_id').primaryKey(),

    /** The destination (email or E.164 phone) the OTP was sent to. */
    destination: text('destination').notNull(),

    /** Old unscoped challenges are never valid authorization for a new flow. */
    purpose: text('purpose').notNull().default('legacy_invalid'),

    /** SHA-256 hash of the 6-digit OTP. Never store plaintext. */
    otpHash: text('otp_hash').notNull(),

    /** Remaining verification attempts before the challenge is invalidated. */
    attemptsRemaining: integer('attempts_remaining').notNull().default(5),

    /** Number of resends triggered for this challenge. */
    resendCount: integer('resend_count').notNull().default(0),

    /** FK to users.user_id, set for login OTP challenges (T-02.01.03). */
    userId: text('user_id'),
    authVersion: integer('auth_version'),
    previousChallengeId: text('previous_challenge_id').references(
      (): AnyPgColumn => otpChallenges.challengeId
    ),

    /** Argon2id password hash, stored during register, consumed on OTP verify. */
    passwordHash: text('password_hash'),

    /** TOS version accepted during registration, consumed on OTP verify. */
    tosVersionId: text('tos_version_id'),

    /** Expiration deadline — default 5 min from creation. */
    expiresAt: timestamp('expires_at', { withTimezone: true, mode: 'date' }).notNull(),

    /** Null until the OTP is successfully verified (single-use enforcement). */
    consumedAt: timestamp('consumed_at', { withTimezone: true, mode: 'date' }),

    /** Password-reset authorization issued after consuming the OTP. Hash only. */
    resetTokenHash: text('reset_token_hash'),
    /** The authorization shares expiresAt and can complete only one reset. */
    resetConsumedAt: timestamp('reset_consumed_at', { withTimezone: true, mode: 'date' }),

    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).defaultNow().notNull(),

    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('uq_otp_reset_token_hash')
      .on(table.resetTokenHash)
      .where(sql`${table.resetTokenHash} IS NOT NULL`),
    check(
      'otp_reset_authorization_state',
      sql`(${table.resetTokenHash} IS NULL AND ${table.resetConsumedAt} IS NULL)
        OR (${table.resetTokenHash} IS NOT NULL AND ${table.purpose}='password_reset' AND ${table.userId} IS NOT NULL
            AND ${table.consumedAt} IS NOT NULL AND ${table.resetTokenHash} ~ '^[a-f0-9]{64}$')`
    ),
    check(
      'otp_username_pair',
      sql`${table.previousChallengeId} IS NULL OR (${table.purpose}='change_username' AND ${table.previousChallengeId}<>${table.challengeId})`
    ),
    uniqueIndex('uq_otp_previous_challenge')
      .on(table.previousChallengeId)
      .where(sql`${table.previousChallengeId} IS NOT NULL`),
    check(
      'otp_challenge_purpose_binding',
      sql`
    ${table.purpose} = 'legacy_invalid'
    OR (${table.purpose} = 'registration' AND ${table.userId} IS NULL
        AND ${table.passwordHash} IS NOT NULL AND ${table.tosVersionId} IS NOT NULL)
    OR (${table.purpose} IN ('login','password_reset','change_username','add_email','add_mobile')
        AND ${table.userId} IS NOT NULL)
  `
    ),
  ]
);

/**
 * SQL to create the otp_challenges table.
 * Includes migration for password_hash and tos_version_id columns (T-01.02.03).
 */
export const createOtpChallengesTable = sql`
  CREATE TABLE IF NOT EXISTS otp_challenges (
    challenge_id TEXT PRIMARY KEY,
    destination TEXT NOT NULL,
    purpose TEXT NOT NULL DEFAULT 'legacy_invalid',
    otp_hash TEXT NOT NULL,
    attempts_remaining INTEGER NOT NULL DEFAULT 5,
    resend_count INTEGER NOT NULL DEFAULT 0,
    password_hash TEXT,
    tos_version_id TEXT,
    expires_at TIMESTAMPTZ NOT NULL,
    consumed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );

  CREATE INDEX IF NOT EXISTS idx_otp_challenges_destination
    ON otp_challenges (destination);

  -- Migration: add password_hash and tos_version_id if not present
  DO $$ BEGIN
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_name = 'otp_challenges' AND column_name = 'password_hash'
    ) THEN
      ALTER TABLE otp_challenges ADD COLUMN password_hash TEXT;
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_name = 'otp_challenges' AND column_name = 'tos_version_id'
    ) THEN
      ALTER TABLE otp_challenges ADD COLUMN tos_version_id TEXT;
    END IF;
  END $$;

  ALTER TABLE otp_challenges ADD COLUMN IF NOT EXISTS purpose TEXT NOT NULL DEFAULT 'legacy_invalid';

  -- Migration: add user_id column for login OTP challenges (T-02.01.03)
  DO $$ BEGIN
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_name = 'otp_challenges' AND column_name = 'user_id'
    ) THEN
      ALTER TABLE otp_challenges ADD COLUMN user_id TEXT REFERENCES users(user_id);
    END IF;
  END $$;
`;
