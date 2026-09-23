import { uuid, bigint, check, pgTable, timestamp, uniqueIndex } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { createTable } from '../base-table';
import { products } from './products';
import { uuidv7 } from '../types';

/**
 * Electricity product limits table.
 *
 * Defines minimum and maximum consumption limits (in kWh) per electricity product.
 * This allows the admin to set per-product constraints such as a minimum purchase
 * quantity or a cap on the maximum kWh that can be ordered.
 *
 * - `id` — UUIDv7 primary key (from base columns).
 * - `product_id` — Foreign key to the product where type = electricity.
 *   Only electricity-type products should reference this table.
 * - `min_kwh` — Minimum kWh allowed (bigint). Default 0 means no minimum limit.
 * - `max_kwh` — Maximum kWh allowed (bigint). Default 0 means no maximum limit.
 * - `created_at` / `updated_at` — audit columns (from base).
 */
export const electricityProductLimits = createTable('electricity_product_limits', {
  /** FK to the electricity product. Only type=electricity should be linked. */
  productId: uuid('product_id')
    .notNull()
    .references(() => products.id, { onDelete: 'restrict' }),

  /** Minimum kWh threshold. 0 means no limit (default). */
  minKwh: bigint('min_kwh', { mode: 'bigint' })
    .notNull()
    .default(sql`0`),

  /** Maximum kWh threshold. 0 means no limit (default). */
  maxKwh: bigint('max_kwh', { mode: 'bigint' })
    .notNull()
    .default(sql`0`),
});

/** Every change to the live limits closes one effective window and opens another. */
export const electricityProductLimitVersions = pgTable(
  'electricity_product_limit_versions',
  {
    id: uuidv7('id').primaryKey(),
    productId: uuid('product_id')
      .notNull()
      .references(() => products.id, { onDelete: 'restrict' }),
    minKwh: bigint('min_kwh', { mode: 'bigint' }).notNull(),
    maxKwh: bigint('max_kwh', { mode: 'bigint' }).notNull(),
    effectiveFrom: timestamp('effective_from', { withTimezone: true, mode: 'date' }).notNull(),
    effectiveUntil: timestamp('effective_until', { withTimezone: true, mode: 'date' }),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('electricity_limit_versions_open_key')
      .on(table.productId)
      .where(sql`${table.effectiveUntil} IS NULL`),
    check(
      'electricity_limit_versions_range',
      sql`${table.effectiveUntil} IS NULL OR ${table.effectiveUntil} > ${table.effectiveFrom}`
    ),
    check(
      'electricity_limit_versions_values',
      sql`${table.minKwh} >= 0 AND (${table.maxKwh} = 0 OR ${table.maxKwh} >= ${table.minKwh})`
    ),
  ]
);
