import { sql } from 'drizzle-orm'
import { text, boolean, numeric } from 'drizzle-orm/pg-core'
import { createTable } from '../base-table'

/**
 * Products table.
 *
 * Stores product definitions — system-defined electricity types and potentially
 * future product categories. System products (those with a non-null `systemType`)
 * are immutable via seed and protected by database-level constraints from
 * deletion or duplication (see T-02.04.06).
 *
 * - `id` — UUIDv7 primary key.
 * - `product_type` — product category, e.g. `'electricity'`. Default `'electricity'`.
 * - `system_type` — immutable system identifier for default products
 *   (`thermal`, `green`, `free_market`, `energy_saving`). Null for
 *   admin-created products. Unique.
 * - `title_fa` — Persian display name.
 * - `price` — current price in IRR (smallest denomination / Rials).
 *   Null until an admin sets a price. Once set, updating the price creates
 *   a new price record; existing subscriptions are not retroactively changed.
 * - `is_active` — whether the product is currently orderable.
 * - `min_kwh` — minimum kWh per billing period (0 = no minimum).
 * - `max_kwh` — maximum kWh per billing period (0 = no maximum).
 * - `created_at` / `updated_at` — audit columns.
 */
export const products = createTable('products', {
  /** Product category discriminator, e.g. `'electricity'`. */
  productType: text('product_type').notNull().default('electricity'),

  /** Immutable system identifier for default products. Unique. */
  systemType: text('system_type').unique(),

  /** Persian display name. */
  titleFa: text('title_fa').notNull(),

  /** Current price in IRR (Rials). Null until admin sets a price. */
  price: numeric('price', { precision: 20, scale: 0 }),

  /** Whether the product is orderable. Default false. */
  isActive: boolean('is_active').notNull().default(false),

  /** Minimum kWh per billing period (0 = no minimum). */
  minKwh: numeric('min_kwh', { precision: 20, scale: 6 })
    .notNull()
    .default('0'),

  /** Maximum kWh per billing period (0 = no maximum). */
  maxKwh: numeric('max_kwh', { precision: 20, scale: 6 })
    .notNull()
    .default('0'),
})

/**
 * SQL to create the products table.
 */
export const createProductsTable = sql`
  CREATE TABLE IF NOT EXISTS products (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v7(),
    product_type TEXT NOT NULL DEFAULT 'electricity',
    system_type TEXT UNIQUE,
    title_fa TEXT NOT NULL,
    price NUMERIC(20, 0),
    is_active BOOLEAN NOT NULL DEFAULT false,
    min_kwh NUMERIC(20, 6) NOT NULL DEFAULT 0,
    max_kwh NUMERIC(20, 6) NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );

  CREATE INDEX IF NOT EXISTS idx_products_system_type ON products (system_type);
  CREATE INDEX IF NOT EXISTS idx_products_product_type ON products (product_type);
`
