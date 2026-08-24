import { sql } from 'drizzle-orm'
import { integer, jsonb, pgTable, text, timestamp } from 'drizzle-orm/pg-core'

/**
 * Application configuration table.
 *
 * Stores admin-managed configuration settings — VAT rates, product prices,
 * thresholds, feature flags — as key-value pairs with version tracking for
 * cache invalidation.
 *
 * All config values are stored as JSONB so the schema supports any serializable
 * value (primitives, objects, arrays) without migration on every change.
 *
 * The `version` column is incremented on every update and is used by the
 * Redis-backed {@link ConfigCacheService} to detect staleness — even when the
 * 5-minute TTL has not expired, a version mismatch forces a cache refresh so
 * financial calculations never use stale values.
 *
 * Row layout uses the `key` as the natural primary key, which is both the
 * stable identifier and the Redis cache key suffix (`config:entry:<key>`).
 */
export const appConfig = pgTable(
  'app_config',
  {
    /** Configuration key, e.g. `vat_rate`, `product_min_price`, `threshold.peak_hours`. */
    key: text('key').primaryKey(),

    /** Configuration value — any JSON-serializable type. */
    value: jsonb('value').notNull(),

    /** Monotonically increasing version number incremented on every update. */
    version: integer('version').notNull().default(1),

    /** When this config entry was last updated. */
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' })
      .defaultNow()
      .notNull(),
  },
)

/**
 * Global configuration version counter.
 *
 * A single-row table that holds a version counter bumped on every config write.
 * Used by the config cache to implement a coarse-grained staleness check: when
 * the global version has changed since the cache entry was populated, all cached
 * config is considered potentially stale even if the per-entry version matches.
 */
export const configVersion = pgTable(
  'config_version',
  {
    /** Singleton row identifier — always `'global'`. */
    id: text('id').primaryKey().default('global'),

    /** Monotonically increasing version number bumped on every config write. */
    version: integer('version').notNull().default(1),

    /** Last time any config entry was modified. */
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' })
      .defaultNow()
      .notNull(),
  },
)

/**
 * SQL to create the app_config table.
 */
export const createAppConfigTable = sql`
  CREATE TABLE IF NOT EXISTS app_config (
    key TEXT PRIMARY KEY,
    value JSONB NOT NULL,
    version INTEGER NOT NULL DEFAULT 1,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );
`

/**
 * SQL to create the config_version table.
 */
export const createConfigVersionTable = sql`
  CREATE TABLE IF NOT EXISTS config_version (
    id TEXT PRIMARY KEY DEFAULT 'global',
    version INTEGER NOT NULL DEFAULT 1,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );

  -- Seed the singleton row on first migration
  INSERT INTO config_version (id, version)
  VALUES ('global', 1)
  ON CONFLICT (id) DO NOTHING;
`