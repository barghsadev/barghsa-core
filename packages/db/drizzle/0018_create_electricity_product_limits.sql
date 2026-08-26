-- Migration 0018: Create electricity_product_limits table (T-03.01.01.04)
--
-- Defines minimum and maximum consumption limits (in kWh) per electricity product.
-- This table is referenced only by electricity-type products. Each electricity
-- product can have one set of min/max limits.
--
-- Columns (from createTable base):
--   - id: UUIDv7 PK (from Drizzle base columns)
--   - created_at / updated_at: TIMESTAMPTZ (from base columns)
-- Domain columns:
--   - product_id: UUID, FK to products.id, ON DELETE RESTRICT
--   - min_kwh: BIGINT, default 0 (0 = no minimum limit)
--   - max_kwh: BIGINT, default 0 (0 = no maximum limit)
--
-- Rollback:
--   DROP TABLE IF EXISTS electricity_product_limits;

-- ---------------------------------------------------------------------------
-- Create electricity_product_limits table
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS electricity_product_limits (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v7(),
  product_id UUID NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
  min_kwh BIGINT NOT NULL DEFAULT 0,
  max_kwh BIGINT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ---------------------------------------------------------------------------
-- Constraints
-- ---------------------------------------------------------------------------

-- Ensure min_kwh <= max_kwh when both are non-zero
-- Covers: max_kwh = 0 (no upper limit, any min is valid) or min_kwh <= max_kwh
ALTER TABLE electricity_product_limits
  ADD CONSTRAINT chk_electricity_product_limits_range
  CHECK (max_kwh = 0 OR min_kwh <= max_kwh);

-- Require at least one limit to be set (min > 0 or max > 0)
ALTER TABLE electricity_product_limits
  ADD CONSTRAINT chk_electricity_product_limits_at_least_one
  CHECK (min_kwh > 0 OR max_kwh > 0);

-- ---------------------------------------------------------------------------
-- Unique constraint: one set of limits per product
-- ---------------------------------------------------------------------------
CREATE UNIQUE INDEX IF NOT EXISTS idx_electricity_product_limits_product_id
  ON electricity_product_limits (product_id);

-- ---------------------------------------------------------------------------
-- Indexes
-- ---------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_electricity_product_limits_min_kwh
  ON electricity_product_limits (min_kwh);
CREATE INDEX IF NOT EXISTS idx_electricity_product_limits_max_kwh
  ON electricity_product_limits (max_kwh);

-- ---------------------------------------------------------------------------
-- Trigger: auto-update updated_at on row modification
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION update_electricity_product_limits_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_electricity_product_limits_updated_at
  BEFORE UPDATE ON electricity_product_limits
  FOR EACH ROW
  EXECUTE FUNCTION update_electricity_product_limits_updated_at();
