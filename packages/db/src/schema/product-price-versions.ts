import { uuid, text } from 'drizzle-orm/pg-core';
import { createTable } from '../base-table';
import { irrAmount, timestamptz } from '../types';
import { products } from './products';
import { users } from './users';
import { vatConfigurations } from './vat-configurations';

/**
 * Product price versions table.
 *
 * Versioned pricing for all product types. Every price change on a product
 * creates a new versioned record rather than mutating the current price
 * in the `products` table. This preserves a complete audit trail and
 * enables point-in-time price lookups for historical orders.
 *
 * - `id` — UUIDv7 primary key (from base columns).
 * - `product_id` — Foreign key to the product, set with ON DELETE RESTRICT
 *   (products with price history cannot be deleted).
 * - `price` — The price in IRR (smallest denomination / Rials) as bigint.
 *   Non-negative: must be >= 0 (enforced by CHECK constraint, see migration).
 * - `vat_category_override` — Optional FK to a VAT configuration. References
 *   the immutable VAT configuration version with ON DELETE RESTRICT.
 * - `effective_from` — Timestamp from which this price takes effect (inclusive).
 * - `effective_until` — Timestamp after which this price is no longer effective
 *   (exclusive). Null means currently active / no known expiry.
 * - `created_by` — Foreign key to the user who created this version.
 * - `created_at` / `updated_at` — audit columns (from base).
 *
 * A CHECK constraint ensures effective_from < effective_until when both are set.
 * An EXCLUDE constraint using tstzrange prevents overlapping effective periods
 * for the same product.
 */
export const productPriceVersions = createTable('product_price_versions', {
  /** FK to the product. ON DELETE RESTRICT enforced at DB level. */
  productId: uuid('product_id')
    .notNull()
    .references(() => products.id, { onDelete: 'restrict' }),

  /** Price in IRR (bigint). Must be >= 0. */
  price: irrAmount('price').notNull(),

  /**
   * Optional FK to vat_configurations (created in T-03.02.05.01).
   * A nullable FK retains unconfigured prices while preventing dangling overrides.
   */
  vatCategoryOverride: uuid('vat_category_override').references(() => vatConfigurations.id, {
    onDelete: 'restrict',
  }),

  /** Timestamp from which this price takes effect (inclusive). */
  effectiveFrom: timestamptz('effective_from').notNull(),

  /** Timestamp after which this price is no longer effective (exclusive).
   *  Null means currently active / no known expiry. */
  effectiveUntil: timestamptz('effective_until'),

  /** FK to the user who created this version. */
  createdBy: text('created_by')
    .notNull()
    .references(() => users.userId, { onDelete: 'restrict' }),
});
