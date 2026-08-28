import { sql } from 'drizzle-orm'
import { integer, text, uuid } from 'drizzle-orm/pg-core'
import { createTable } from '../base-table'
import { timestamptz } from '../types'
import { products } from './products'
import { users } from './users'

/**
 * VAT configurations — versioned rates by charge category (T-09.12.02).
 *
 * One row is ONE versioned rate: `rate` is stored as integer basis
 * points (900 = 9.00%) and each row carries an effective window
 * (`effective_from` inclusive, `effective_until` exclusive; null = open).
 * Adding a new rate for a category appends a row; a rate is never
 * mutated or hard-deleted — it is end-dated (`effective_until`) instead,
 * preserving the complete rate history for invoice snapshotting.
 *
 * - `category` — charge category key. The canonical set lives in
 *   `@barghsa/shared/finance` (`CHARGE_CATEGORIES`). Product-specific
 *   override rates use the reserved `product_override` key and are only
 *   reachable through `product_vat_overrides` links.
 * - `rate` — integer basis points, CHECK 0..10000 (0%..100%).
 * - `created_by` — FK to the admin user who recorded the rate.
 *
 * The migration (0047) also declares:
 *   - a CHECK that `effective_until` is null or after `effective_from`;
 *   - a GIST EXCLUDE constraint forbidding overlapping effective windows
 *     for the same category (at most one open row per category);
 *   - the `updated_at` trigger.
 */
export const vatConfigurations = createTable('vat_configurations', {
  /** Charge category key (canonical set in @barghsa/shared/finance). */
  category: text('category').notNull(),

  /** Rate in basis points (900 = 9.00%). CHECK 0..10000. */
  rate: integer('rate').notNull(),

  /** Window start (inclusive). */
  effectiveFrom: timestamptz('effective_from').notNull(),

  /** Window end (exclusive); null = open/current. */
  effectiveUntil: timestamptz('effective_until'),

  /** Admin who recorded this rate. */
  createdBy: text('created_by')
    .notNull()
    .references(() => users.userId, { onDelete: 'restrict' }),
})

/**
 * Product VAT overrides (T-09.12.02 / T-03.02.05.02).
 *
 * Links a product to a vat_configurations row: while the override window
 * is active, the product uses the linked config's rate instead of its
 * category default. Resolution order (T-09.12.02): product override >
 * category default > 0% fallback.
 *
 * - `product_id` — FK products.id (ON DELETE RESTRICT: a product with an
 *   override cannot be deleted — the archive-only path applies).
 * - `vat_config_id` — FK vat_configurations.id (ON DELETE RESTRICT:
 *   rates are versioned records, never removed).
 * - effective window mirrors vat_configurations semantics; at most one
 *   open override per product (EXCLUDE in migration 0047).
 */
export const productVatOverrides = createTable('product_vat_overrides', {
  /** The product whose VAT rate is overridden. */
  productId: uuid('product_id')
    .notNull()
    .references(() => products.id, { onDelete: 'restrict' }),

  /** The vat_configurations row whose rate applies while active. */
  vatConfigId: uuid('vat_config_id')
    .notNull()
    .references(() => vatConfigurations.id, { onDelete: 'restrict' }),

  /** Window start (inclusive). */
  effectiveFrom: timestamptz('effective_from').notNull(),

  /** Window end (exclusive); null = open/current. */
  effectiveUntil: timestamptz('effective_until'),

  /** Admin who recorded the override. */
  createdBy: text('created_by')
    .notNull()
    .references(() => users.userId, { onDelete: 'restrict' }),
})

/** SQL to create the vat_configurations table (migration 0047 source). */
export const createVatConfigurationsTable = sql`
  CREATE TABLE IF NOT EXISTS vat_configurations (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v7(),
    category TEXT NOT NULL,
    rate INTEGER NOT NULL,
    effective_from TIMESTAMPTZ NOT NULL,
    effective_until TIMESTAMPTZ,
    created_by TEXT NOT NULL REFERENCES users(user_id) ON DELETE RESTRICT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT chk_vat_configurations_rate_range CHECK (rate BETWEEN 0 AND 10000),
    CONSTRAINT chk_vat_configurations_effective_range
      CHECK (effective_until IS NULL OR effective_from < effective_until)
  );

  CREATE EXTENSION IF NOT EXISTS btree_gist;

  ALTER TABLE vat_configurations
    ADD CONSTRAINT excl_vat_configurations_no_overlap
    EXCLUDE USING GIST (
      category WITH =,
      tstzrange(effective_from, COALESCE(effective_until, 'infinity'::TIMESTAMPTZ), '[)') WITH &&
    );

  CREATE INDEX IF NOT EXISTS idx_vat_configurations_category
    ON vat_configurations (category);
  CREATE INDEX IF NOT EXISTS idx_vat_configurations_effective_from
    ON vat_configurations (effective_from);
`

/** SQL to create the product_vat_overrides table (migration 0047 source). */
export const createProductVatOverridesTable = sql`
  CREATE TABLE IF NOT EXISTS product_vat_overrides (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v7(),
    product_id UUID NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
    vat_config_id UUID NOT NULL REFERENCES vat_configurations(id) ON DELETE RESTRICT,
    effective_from TIMESTAMPTZ NOT NULL,
    effective_until TIMESTAMPTZ,
    created_by TEXT NOT NULL REFERENCES users(user_id) ON DELETE RESTRICT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT chk_product_vat_overrides_effective_range
      CHECK (effective_until IS NULL OR effective_from < effective_until)
  );

  ALTER TABLE product_vat_overrides
    ADD CONSTRAINT excl_product_vat_overrides_no_overlap
    EXCLUDE USING GIST (
      product_id WITH =,
      tstzrange(effective_from, COALESCE(effective_until, 'infinity'::TIMESTAMPTZ), '[)') WITH &&
    );

  CREATE INDEX IF NOT EXISTS idx_product_vat_overrides_product_id
    ON product_vat_overrides (product_id);
  CREATE INDEX IF NOT EXISTS idx_product_vat_overrides_vat_config_id
    ON product_vat_overrides (vat_config_id);
`