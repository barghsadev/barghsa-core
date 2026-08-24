import { customType, bigint, numeric, timestamp } from 'drizzle-orm/pg-core'

/**
 * PostgreSQL `uuid` column backed by `uuid_generate_v7()`.
 *
 * UUIDv7 encodes the current Unix timestamp in milliseconds (48 bits)
 * followed by random bits (74 bits), providing monotonic ordering and
 * index locality. The actual PostgreSQL function `uuid_generate_v7()`
 * is created in a migration (T-02.02.03).
 *
 * Usage:
 * ```ts
 * id: uuidv7('id').primaryKey().default(sql`uuid_generate_v7()`)
 * ```
 *
 * The `uuid_generate_v7()` default is wired in the base table factory
 * (packages/db/src/schema) rather than embedded here.
 */
export const uuidv7 = customType<{ data: string }>({
  dataType() {
    return 'uuid'
  },
})

/**
 * PostgreSQL `timestamp with time zone` — always UTC.
 *
 * Returns a `Date` object. Business timezone metadata is stored
 * separately per record where needed.
 *
 * Usage:
 * ```ts
 * createdAt: timestamptz('created_at').defaultNow().notNull()
 * ```
 */
export const timestamptz = (name?: string) =>
  name
    ? timestamp(name, { withTimezone: true, mode: 'date' })
    : timestamp({ withTimezone: true, mode: 'date' })

/**
 * 64-bit signed integer (`bigint`) for IRR amounts.
 *
 * Max value ~9.22e18, sufficient for large IRR amounts stored as
 * the smallest denomination (Rials). Returns a JavaScript `bigint`
 * to preserve full 64-bit precision — values above
 * `Number.MAX_SAFE_INTEGER` (9,007,199,254,740,991) are not silently
 * truncated.
 *
 * Usage:
 * ```ts
 * amount: irrAmount('amount').notNull()
 * ```
 */
export const irrAmount = (name?: string) =>
  name ? bigint(name, { mode: 'bigint' }) : bigint({ mode: 'bigint' })

/**
 * Fixed-precision decimal (`numeric(20, 6)`) for rates and quantities.
 *
 * Returns a string to preserve full precision. Never use `float4`/`float8`
 * for financial, contractual, or quantity columns.
 *
 * Usage:
 * ```ts
 * rate: fixedDecimal('rate').notNull()
 * ```
 */
export const fixedDecimal = (name?: string) =>
  name ? numeric(name, { precision: 20, scale: 6 }) : numeric({ precision: 20, scale: 6 })

/**
 * PostgreSQL `tstzrange` — half-open range `[start, end)`.
 *
 * Stored as the native PostgreSQL `tstzrange` type. Enforce `[start, end)`
 * semantics at the database level with a CHECK constraint:
 *
 * ```sql
 * CHECK (lower_inc(validity_period) AND NOT upper_inc(validity_period))
 * ```
 *
 * Usage:
 * ```ts
 * validityPeriod: halfOpenRange('validity_period')
 * ```
 */
export const halfOpenRange = customType<{ data: string; driverData: string }>({
  dataType() {
    return 'tstzrange'
  },
})

/**
 * Build a PostgreSQL tstzrange literal string with `[start, end)` bounds.
 *
 * Use this helper when constructing range values in application code or
 * seed scripts to ensure consistent half-open semantics.
 *
 * @param start ISO 8601 start timestamp (inclusive)
 * @param end   ISO 8601 end timestamp (exclusive)
 * @returns A PostgreSQL tstzrange literal, e.g. `'[2026-01-01T00:00:00Z,2027-01-01T00:00:00Z)'`
 */
export function halfOpenRangeValue(start: string, end: string): string {
  return `[${start},${end})`
}

// Re-export drizzle-orm pgEnum for enum-like status fields
export { pgEnum } from 'drizzle-orm/pg-core'