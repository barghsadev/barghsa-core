import { jsonb, text } from 'drizzle-orm/pg-core'
import { createTable } from '../base-table'
import { pgEnum, irrAmount } from '../types'

/**
 * Product type discriminator.
 *
 * - `consultation` — Consultation products (electricity generation station, saving certificate)
 * - `electricity` — Electricity supply products (thermal, green, free market, energy saving)
 * - `hardware` — Physical hardware products for power saving plans
 * - `saving_plan` — Power saving plan products (separate from hardware, linked M:N)
 */
export const productTypeEnum = pgEnum('product_type', [
  'consultation',
  'electricity',
  'hardware',
  'saving_plan',
])

/**
 * Product lifecycle status.
 *
 * - `active` — Visible and orderable
 * - `inactive` — Hidden from ordering but not deleted; admin can reactivate
 * - `archived` — No longer in use; preserved for historical reference
 */
export const productStatusEnum = pgEnum('product_status', [
  'active',
  'inactive',
  'archived',
])

/**
 * Products table.
 *
 * Central catalog for all product types. System products (electricity types)
 * are identified by a non-null `system_key` and are immutable — they cannot
 * be deleted, have their `system_key` or `type` changed, and no additional
 * electricity-type products can be created. This is enforced at both the
 * API and DB level (see migration T-03.01.02.04).
 *
 * - `id` — UUIDv7 primary key (from base columns).
 * - `type` — Product category discriminator (pgEnum).
 * - `system_key` — Immutable system identifier for default products (e.g.
 *   `thermal_electricity`). Null for admin-created products. Unique.
 * - `title` — Localized JSONB object, e.g. `{"fa": "برق حرارتی", "en": "Thermal Electricity"}`.
 * - `description` — Localized JSONB object, nullable.
 * - `price` — Current price in IRR (smallest denomination / Rials) as bigint.
 *   Null until an admin sets a price. Price changes create a versioned record
 *   in `product_price_versions` (T-03.01.01.02).
 * - `status` — Product lifecycle status (pgEnum). Default `inactive`.
 * - `created_at` / `updated_at` — audit columns (from base).
 */
export const products = createTable('products', {
  /** Product category discriminator. */
  type: productTypeEnum('type').notNull().default('electricity'),

  /** Immutable system identifier for default products. Unique, nullable for admin-created products. */
  systemKey: text('system_key').unique(),

  /** Localized title (JSONB: { "fa": "...", "en": "..." }). */
  title: jsonb('title').notNull(),

  /** Localized description (JSONB, nullable). */
  description: jsonb('description'),

  /** Current price in IRR (bigint). Null until admin sets a price. */
  price: irrAmount('price'),

  /** Product lifecycle status: active, inactive, archived. Default: inactive. */
  status: productStatusEnum('status').notNull().default('inactive'),
})
