import { sql } from 'drizzle-orm'
import { bigint, integer, pgTable, text, timestamp, uniqueIndex } from 'drizzle-orm/pg-core'

/**
 * Rate-limit counter rows stored in PostgreSQL.
 *
 * This table serves as the durable fallback when Redis is unavailable,
 * and as the primary store for security-critical counters (OTP, password
 * attempts, login attempts) that must never be lost on a Redis flush.
 *
 * Row layout uses a compound primary key of (key, window_start) so that
 * concurrent `INSERT ... ON CONFLICT` operations on the same key in the
 * same window reliably update the counter without deadlocks or duplicates.
 *
 * Expired rows are cleaned up by `PostgresRateLimiterStore.cleanup()` on a
 * best-effort basis when the table grows large enough to warrant a periodic
 * vacuum-age reaper (run as a cron job or sidekiq-like worker).
 */
export const rateLimitCounters = pgTable(
  'rate_limit_counters',
  {
    /** Namespaced key, e.g. `api:192.168.1.1` or `otp:+989123456789`. */
    key: text('key').notNull(),
    /** Start of the current sliding window (epoch milliseconds). */
    windowStart: bigint('window_start', { mode: 'number' }).notNull(),
    /** Window duration in milliseconds. */
    windowMs: integer('window_ms').notNull(),
    /** Current counter value. */
    count: integer('count').notNull().default(1),
    /** Created at (informational, for debugging). */
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' })
      .defaultNow()
      .notNull(),
    /** Last updated at. */
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' })
      .defaultNow()
      .notNull(),
  },
  (table) => ({
    // Compound PK: one row per key per window — enables upsert semantics
    pk: uniqueIndex('rate_limit_counters_pk').on(table.key, table.windowStart),
  }),
)

/**
 * Rate-limit metadata / OTP-critical counter table.
 *
 * For security-critical rate limits (OTP, login, password reset) the
 * PostgreSQL counter is the authoritative source even when Redis is also
 * used for fast checks.  This table mirrors the main counter but with
 * a dedicated, never-Redis-only semantic.
 */
export const securityRateLimitCounters = pgTable(
  'security_rate_limit_counters',
  {
    /** Namespaced key, e.g. `otp:+989123456789`. */
    key: text('key').notNull(),
    /** Start of the current sliding window (epoch milliseconds). */
    windowStart: bigint('window_start', { mode: 'number' }).notNull(),
    /** Window duration in milliseconds. */
    windowMs: integer('window_ms').notNull(),
    /** Current counter value. */
    count: integer('count').notNull().default(1),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' })
      .defaultNow()
      .notNull(),
  },
  (table) => ({
    pk: uniqueIndex('security_rate_limit_counters_pk').on(table.key, table.windowStart),
  }),
)

/**
 * SQL to create the rate_limit_counters table and its index via raw migration.
 */
export const createRateLimitCountersTable = sql`
  CREATE TABLE IF NOT EXISTS rate_limit_counters (
    key TEXT NOT NULL,
    window_start BIGINT NOT NULL,
    window_ms INTEGER NOT NULL,
    count INTEGER NOT NULL DEFAULT 1,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );

  CREATE UNIQUE INDEX IF NOT EXISTS rate_limit_counters_pk
    ON rate_limit_counters (key, window_start);
`

/**
 * SQL to create the security_rate_limit_counters table.
 */
export const createSecurityRateLimitCountersTable = sql`
  CREATE TABLE IF NOT EXISTS security_rate_limit_counters (
    key TEXT NOT NULL,
    window_start BIGINT NOT NULL,
    window_ms INTEGER NOT NULL,
    count INTEGER NOT NULL DEFAULT 1,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );

  CREATE UNIQUE INDEX IF NOT EXISTS security_rate_limit_counters_pk
    ON security_rate_limit_counters (key, window_start);
`