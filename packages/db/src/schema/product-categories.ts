import { uuid } from 'drizzle-orm/pg-core'
import { createTable } from '../base-table'
import { pgEnum } from '../types'
import { products } from './products'

/**
 * Product category discriminator.
 *
 * Used only for electricity and consultation product types.
 *
 * - `electricity_generation_station_consultation` — Consultation for establishing an electricity generation station
 * - `electricity_saving_certificate_consultation` — Consultation for electricity saving certificates
 * - `thermal_electricity` — Thermal electricity supply
 * - `green_electricity` — Green/renewable electricity supply
 * - `free_market_electricity` — Free market electricity supply
 * - `energy_saving_electricity` — Energy saving electricity supply
 */
export const productCategoryEnum = pgEnum('product_category', [
  'electricity_generation_station_consultation',
  'electricity_saving_certificate_consultation',
  'thermal_electricity',
  'green_electricity',
  'free_market_electricity',
  'energy_saving_electricity',
])

/**
 * Product categories table.
 *
 * Maps a product to its category/categories. Only applicable for electricity and
 * consultation product types. Each product can have multiple categories.
 *
 * - `id` — UUIDv7 primary key (from base columns).
 * - `product_id` — Foreign key to the product, with ON DELETE RESTRICT.
 * - `category` — Category enum value for this product.
 */
export const productCategories = createTable('product_categories', {
  /** FK to the product. Only electricity and consultation types should be linked. */
  productId: uuid('product_id')
    .notNull()
    .references(() => products.id, { onDelete: 'restrict' }),

  /** Product category enum value. */
  category: productCategoryEnum('category').notNull(),
})
