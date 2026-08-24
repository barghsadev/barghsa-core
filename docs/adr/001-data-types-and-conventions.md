# ADR-001: Data Types and Column Conventions

**Status:** Accepted  
**Date:** 2026-08-24  
**Deciders:** Platform Engineering Team  
**Dependencies:** T-02.02.01, T-02.02.02, T-02.02.03  

## Context

The platform needs a consistent set of data type conventions across all database schemas to ensure correctness, maintainability, and safety — particularly in financial and contractual contexts. These conventions are enforced at the Drizzle ORM type layer and documented here for reference.

## Decision

### 1. UUIDv7 for Primary Keys (not UUIDv4)

All primary keys use **UUIDv7** (RFC 9562) via a custom `uuidv7` column type backed by a PostgreSQL `uuid_generate_v7()` function.

**UUIDv7 benefits over UUIDv4:**

| Aspect | UUIDv4 | UUIDv7 |
|---|---|---|
| Sort order | Random | Time-ordered (by ms) |
| B-tree index locality | Poor — random inserts fragment pages | Good — new values cluster in time order |
| Index page splits | Frequent | Minimal |
| Sequential scan performance | No ordering benefit | Roughly insert-order |
| Collision resistance | 122 random bits | 74 random bits (sufficient) |
| Timestamp extraction | Not possible | 48-bit ms timestamp embedded |

UUIDv7 provides the distribution benefits of UUIDs (no central coordinator, safe to generate offline, no sequential leak) while avoiding the B-tree index fragmentation that plagues UUIDv4 in large tables.

**Implementation:** `packages/db/src/types.ts` — `uuidv7()` column builder with `DEFAULT uuid_generate_v7()`.

**Migration:** `packages/db/drizzle/0000_init_uuidv7_function.sql` creates the `uuid_generate_v7()` PL/pgSQL function using `clock_timestamp()` so each concurrent call within the same transaction receives a distinct timestamp. Values from different milliseconds are time-ordered; values within the same millisecond carry random bits and are not guaranteed monotonic.

### 2. UTC Timestamps with `timestamptz`

All timestamp columns use PostgreSQL `timestamp with time zone` (`timestamptz`), stored internally in UTC.

- **Column type:** `timestamptz` via the custom `timestamptz()` builder in `packages/db/src/types.ts`.
- **Mode:** `'date'` — returns native JavaScript `Date` objects.
- **Timezone metadata:** Business/display timezone is stored **per record** where needed (e.g. a `timezone` column on the customer or account record), not in the timestamp column itself.
- **Always UTC:** Applications read/write in UTC; timezone conversion happens at the display layer only.
- **Default:** `created_at` has `DEFAULT now()` via `defaultNow()`. `updated_at` uses `$onUpdate(() => new Date())` for ORM-level auto-stamping.

**Rationale:** Storing timestamps with timezone offsets in the column is error-prone and makes queries, joins, and comparisons fragile. UTC is the canonical representation; timezone conversion is a presentation concern.

### 3. Half-Open Range Semantics `[start, end)`

Temporal validity ranges use PostgreSQL `tstzrange` with **half-open semantics**: the start bound is inclusive (`[`) and the end bound is exclusive (`)`).

- **Column type:** `tstzrange` via `halfOpenRange()` in `packages/db/src/types.ts`.
- **Enforcement:** A `CHECK` constraint must be added to every range column:
  ```sql
  CHECK (lower_inc(column_name) AND NOT upper_inc(column_name))
  ```
- **Helper:** `halfOpenRangeValue(start, end)` produces literal range strings.
- **Rationale:** Half-open ranges are the standard temporal model in database theory (Allen's interval algebra) and avoid ambiguity at boundary points. Two ranges `[A, B)` and `[B, C)` are adjacent without overlap — a property that closed intervals lack.

### 4. Integer IRR Amounts (`bigint`)

Monetary amounts in Iranian Rial (IRR) use **64-bit signed integer** (`bigint`), stored as the smallest denomination (Rials, not Toman).

- **Column type:** `bigint` with `mode: 'bigint'` via `irrAmount()` in `packages/db/src/types.ts`.
- **Precision:** Full 64-bit range (~9.22e18), sufficient for large IRR amounts.
- **JavaScript type:** Returns `bigint` to preserve values above `Number.MAX_SAFE_INTEGER` (9,007,199,254,740,991).
- **Why not `numeric`/`decimal`:** `bigint` is faster, uses less storage, and avoids decimal-point ambiguity. IRR has no sub-unit denomination (no "cents").
- **Display:** Formatting to human-readable IRR or Toman happens at the presentation layer, not in the database.

### 5. Fixed-Precision Decimal for Rates and Quantities

Rates, percentages, coefficients, and non-currency quantities use **`numeric(20, 6)`** — a fixed-precision decimal with 20 significant digits and 6 decimal places.

- **Column type:** `numeric(20, 6)` via `fixedDecimal()` in `packages/db/src/types.ts`.
- **JavaScript type:** Returns a **string** to preserve full precision (no floating-point rounding).
- **Precision rationale:** 20 digits with 6 decimal places accommodates rates like 0.000001 (0.0001%) up to 999,999,999,999.999999, covering all practical billing and metering scenarios.
- **Scale rationale:** 6 decimal places matches the finest granularity needed for kWh metering (watt-hour resolution) and percentage calculations.

### 6. Prohibition of Floating-Point in Financial Contexts

**`float4` and `float8` (IEEE 754 binary floating-point) are strictly prohibited** for any column that stores monetary amounts, rates, quantities, or any value used in financial calculations.

- **Rationale:** IEEE 754 floating-point cannot represent common decimal values exactly (e.g. 0.1, 0.07). Accumulated rounding errors in billing, invoicing, and financial reporting are unacceptable.
- **Allowed types:** `bigint` (for integer-denomination amounts) or `numeric` (for fixed-precision decimal values).
- **Enforcement:** Code review must catch any `float`/`float4`/`float8`/`real`/`double precision` columns in financial or contractual contexts.

### 7. Base Columns Convention

Every domain table includes these three base columns, provided automatically by the `createTable()` factory:

| Column | Type | Default | Description |
|---|---|---|---|
| `id` | `uuid` (UUIDv7) | `uuid_generate_v7()` | Primary key, time-sortable |
| `created_at` | `timestamptz` | `now()` | Set on INSERT, never updated |
| `updated_at` | `timestamptz` | `now()` + `$onUpdate` | Updated on every row modification |

**Implementation:** `packages/db/src/base-table.ts` — `createTable()` spreads `baseColumns` into every table definition.

### 8. Column Naming Convention

- **Snake case** in the database: `created_at`, `updated_at`, `validity_period`, `customer_id`.
- **Camel case** in TypeScript Drizzle schema definitions: `createdAt`, `updatedAt`, `validityPeriod`, `customerId`.
- Mapping is handled by Drizzle's first argument to each column builder (the database column name).

## Consequences

**Positive:**
- Consistent type system across all schemas reduces cognitive load and review effort.
- UUIDv7 avoids both sequence-based enumeration attacks and UUIDv4 index fragmentation.
- `bigint` for IRR avoids decimal rounding errors and is faster than `numeric`.
- `numeric(20, 6)` for rates provides sufficient precision without floating-point pitfalls.
- Half-open ranges eliminate temporal boundary ambiguity.
- UTC-only timestamps simplify querying, indexing, and cross-timezone aggregation.

**Negative:**
- `bigint` amounts require explicit formatting at the presentation layer (no built-in currency formatting from the database).
- UUIDv7 primary keys are larger than `serial`/`bigserial` (16 bytes vs 4/8 bytes), increasing index size slightly.
- `numeric(20, 6)` returns strings in JavaScript, requiring conversion before arithmetic operations.
- ORM-level `$onUpdate` for `updated_at` does not cover raw SQL writes outside the ORM — a future trigger-based approach (`modify_updated_at()`) should complement it.

## Compliance

- All new tables must use `createTable()` from `@barghsa/db/base-table`.
- All monetary columns must use `irrAmount()` from `@barghsa/db/types`.
- All rate/quantity columns must use `fixedDecimal()` from `@barghsa/db/types`.
- No `float4`/`float8`/`real`/`double precision` columns in financial or contractual contexts.
- Range columns must include a CHECK constraint enforcing half-open semantics.
- Timestamp columns must be `timestamptz` with `mode: 'date'`.