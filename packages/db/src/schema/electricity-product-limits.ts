import { uuid, bigint } from 'drizzle-orm/pg-core'
import { createTable } from '../base-table'
import { products } from './products'

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
  minKwh: bigint('min_kwh', { mode: 'bigint' }).notNull().default(0n),

  /** Maximum kWh threshold. 0 means no limit (default). */
  maxKwh: bigint('max_kwh', { mode: 'bigint' }).notNull().default(0n),
})
