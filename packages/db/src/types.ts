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
 * the smallest denomination (Rials). Returns a JavaScript `number`
 * (53-bit safe integer, ~9e15) — sufficient for all practical IRR
 * amounts.
 *
 * Usage:
 * ```ts
 * amount: irrAmount('amount').notNull()
 * ```
 */
export const irrAmount = (name?: string) =>
  name ? bigint(name, { mode: 'number' }) : bigint({ mode: 'number' })

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
 * Enforces timezone-aware range semantics at the schema level.
 * Stored as the native PostgreSQL `tstzrange` type.
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

// Re-export drizzle-orm pgEnum for enum-like status fields
export { pgEnum } from 'drizzle-orm/pg-core'