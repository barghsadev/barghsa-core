-- Migration 0017: Create product_categories table (T-03.01.01.03)
--
-- Maps a product to its category/categories. Only applicable for electricity
-- and consultation product types. Each product can have multiple categories.
--
-- The product_category enum covers:
--   - Electricity generation station consultation
--   - Electricity saving certificate consultation
--   - Thermal electricity
--   - Green electricity
--   - Free market electricity
--   - Energy saving electricity
--
-- Columns (from createTable base):
--   - id: UUIDv7 PK (from Drizzle base columns)
--   - created_at / updated_at: TIMESTAMPTZ (from base columns)
-- Domain columns:
--   - product_id: UUID, FK to products.id, ON DELETE RESTRICT
--   - category: product_category enum, not null
--
-- Rollback:
--   DROP TABLE IF EXISTS product_categories;
--   DROP TYPE IF EXISTS product_category;

-- ---------------------------------------------------------------------------
-- Create product_category enum
-- ---------------------------------------------------------------------------
DO $$ BEGIN
  CREATE TYPE product_category AS ENUM (
    'electricity_generation_station_consultation',
    'electricity_saving_certificate_consultation',
    'thermal_electricity',
    'green_electricity',
    'free_market_electricity',
    'energy_saving_electricity'
  );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- ---------------------------------------------------------------------------
-- Create product_categories table
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS product_categories (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v7(),
  product_id UUID NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
  category product_category NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ---------------------------------------------------------------------------
-- Indexes
-- ---------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_product_categories_product_id
  ON product_categories (product_id);
CREATE INDEX IF NOT EXISTS idx_product_categories_category
  ON product_categories (category);

-- ---------------------------------------------------------------------------
-- Unique constraint: prevent duplicate category assignments per product
-- ---------------------------------------------------------------------------
CREATE UNIQUE INDEX IF NOT EXISTS idx_product_categories_unique_product_category
  ON product_categories (product_id, category);

-- ---------------------------------------------------------------------------
-- Trigger: auto-update updated_at on row modification
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION update_product_categories_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_product_categories_updated_at
  BEFORE UPDATE ON product_categories
  FOR EACH ROW
  EXECUTE FUNCTION update_product_categories_updated_at();
