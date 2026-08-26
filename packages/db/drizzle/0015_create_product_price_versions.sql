-- Migration 0015: Create product_price_versions table for versioned pricing (T-03.01.01.02)
--
-- Every price change on a product creates a new versioned record rather than
-- mutating the current price in the products table. This enables point-in-time
-- price lookups and preserves a complete audit trail.
--
-- Columns:
--   - id: UUIDv7 PK (from base columns via Drizzle createTable)
--   - product_id: FK to products.id, ON DELETE RESTRICT
--   - price: BIGINT (irrAmount), must be >= 0
--   - vat_category_override: UUID, nullable FK placeholder for vat_configurations (T-03.02.05.01)
--   - effective_from: TIMESTAMPTZ, not null — when this price takes effect
--   - effective_until: TIMESTAMPTZ, nullable — when this price expires (null = active)
--   - created_by: TEXT, FK to users.user_id, ON DELETE RESTRICT
--   - created_at / updated_at: TIMESTAMPTZ (from base columns)
--
-- Constraints:
--   - CHECK: effective_from < effective_until when both are set
--   - CHECK: price >= 0
--   - EXCLUDE: prevent overlapping effective periods for the same product
--     using tstzrange with [start, end) semantics (half-open)
--
-- Rollback:
--   DROP TABLE IF EXISTS product_price_versions CASCADE;

-- ---------------------------------------------------------------------------
-- Create product_price_versions table
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS product_price_versions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v7(),
  product_id UUID NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
  price BIGINT NOT NULL,
  vat_category_override UUID,
  effective_from TIMESTAMPTZ NOT NULL,
  effective_until TIMESTAMPTZ,
  created_by TEXT NOT NULL REFERENCES users(user_id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ---------------------------------------------------------------------------
-- Constraints
-- ---------------------------------------------------------------------------

-- Non-negative price enforcement
ALTER TABLE product_price_versions
  ADD CONSTRAINT chk_product_price_versions_price_non_negative
  CHECK (price >= 0);

-- Ensure effective_from < effective_until when both are set
ALTER TABLE product_price_versions
  ADD CONSTRAINT chk_product_price_versions_effective_range
  CHECK (effective_until IS NULL OR effective_from < effective_until);

-- Prevent overlapping effective periods for the same product using tstzrange
-- with half-open [start, end) semantics. Null effective_until is treated as
-- "infinity" (still active). Two versions of the same product cannot have
-- overlapping ranges: [effective_from, effective_until) for each product.
CREATE EXTENSION IF NOT EXISTS btree_gist;

ALTER TABLE product_price_versions
  ADD CONSTRAINT excl_product_price_versions_no_overlap
  EXCLUDE USING GIST (
    product_id WITH =,
    tstzrange(effective_from, COALESCE(effective_until, 'infinity'::TIMESTAMPTZ), '[)') WITH &&
  );

-- ---------------------------------------------------------------------------
-- Indexes
-- ---------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_product_price_versions_product_id
  ON product_price_versions (product_id);
CREATE INDEX IF NOT EXISTS idx_product_price_versions_effective_from
  ON product_price_versions (effective_from);
CREATE INDEX IF NOT EXISTS idx_product_price_versions_effective_until
  ON product_price_versions (effective_until);

-- ---------------------------------------------------------------------------
-- Trigger: auto-update updated_at on row modification
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION update_product_price_versions_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_product_price_versions_updated_at
  BEFORE UPDATE ON product_price_versions
  FOR EACH ROW
  EXECUTE FUNCTION update_product_price_versions_updated_at();
