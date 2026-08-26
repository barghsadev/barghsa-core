-- Migration 0014: Recreate products table with full product catalog schema (T-03.01.01.01)
--
-- Replaces the early skeleton products table with the complete product catalog
-- schema from S-03.01.01. Changes:
--   - product_type TEXT → type product_type (pgEnum: consultation, electricity, hardware, saving_plan)
--   - system_type TEXT → system_key TEXT (renamed)
--   - title_fa TEXT → title JSONB (localized)
--   - +description JSONB (nullable)
--   - price NUMERIC(20,0) → price BIGINT (irrAmount)
--   - is_active BOOLEAN → status product_status (pgEnum: active, inactive, archived)
--   - min_kwh/max_kwh → removed (moved to electricity_product_limits table, T-03.01.01.04)
--
-- Rollback:
--   DROP TRIGGER IF EXISTS trg_prevent_system_product_delete ON products;
--   DROP TRIGGER IF EXISTS trg_prevent_system_type_change ON products;
--   DROP TRIGGER IF EXISTS trg_prevent_extra_system_product_insert ON products;
--   DROP FUNCTION IF EXISTS prevent_system_product_delete();
--   DROP FUNCTION IF EXISTS prevent_system_type_change();
--   DROP FUNCTION IF EXISTS prevent_extra_system_product_insert();
--   DROP TABLE IF EXISTS products CASCADE;
--   DROP TYPE IF EXISTS product_type;
--   DROP TYPE IF EXISTS product_status;

-- ---------------------------------------------------------------------------
-- Create enums
-- ---------------------------------------------------------------------------
DO $$ BEGIN
  CREATE TYPE product_type AS ENUM ('consultation', 'electricity', 'hardware', 'saving_plan');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE product_status AS ENUM ('active', 'inactive', 'archived');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- ---------------------------------------------------------------------------
-- Drop old triggers before dropping the old table
-- ---------------------------------------------------------------------------
DROP TRIGGER IF EXISTS trg_prevent_system_product_delete ON products;
DROP TRIGGER IF EXISTS trg_prevent_system_type_change ON products;
DROP TRIGGER IF EXISTS trg_prevent_extra_system_product_insert ON products;
DROP FUNCTION IF EXISTS prevent_system_product_delete();
DROP FUNCTION IF EXISTS prevent_system_type_change();
DROP FUNCTION IF EXISTS prevent_extra_system_product_insert();

-- ---------------------------------------------------------------------------
-- Drop old table (safe in early dev — no production data)
-- ---------------------------------------------------------------------------
DROP TABLE IF EXISTS products CASCADE;

-- ---------------------------------------------------------------------------
-- Create new products table
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS products (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v7(),
  type product_type NOT NULL DEFAULT 'electricity',
  system_key TEXT UNIQUE,
  title JSONB NOT NULL,
  description JSONB,
  price BIGINT,
  status product_status NOT NULL DEFAULT 'inactive',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_products_type ON products (type);
CREATE INDEX IF NOT EXISTS idx_products_status ON products (status);
CREATE INDEX IF NOT EXISTS idx_products_system_key ON products (system_key);

-- ---------------------------------------------------------------------------
-- Recreate system-product protection triggers (updated for new column names)
-- ---------------------------------------------------------------------------

-- 1. Prevent DELETE of system-defined products
CREATE OR REPLACE FUNCTION prevent_system_product_delete()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF OLD.type = 'electricity' AND OLD.system_key IS NOT NULL THEN
    RAISE EXCEPTION 'Cannot delete system-defined electricity product (system_key: %)', OLD.system_key
      USING ERRCODE = 'P0001';
  END IF;
  RETURN OLD;
END;
$$;

CREATE TRIGGER trg_prevent_system_product_delete
  BEFORE DELETE ON products
  FOR EACH ROW
  EXECUTE FUNCTION prevent_system_product_delete();

-- 2. Prevent UPDATE of system_key on system products
CREATE OR REPLACE FUNCTION prevent_system_key_change()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF OLD.system_key IS NOT NULL AND NEW.system_key IS DISTINCT FROM OLD.system_key THEN
    RAISE EXCEPTION 'Cannot change system_key of system-defined product (system_key: %)', OLD.system_key
      USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_prevent_system_key_change
  BEFORE UPDATE ON products
  FOR EACH ROW
  EXECUTE FUNCTION prevent_system_key_change();

-- 3. Prevent INSERT of extra system-defined electricity products (max 4)
CREATE OR REPLACE FUNCTION prevent_extra_system_product_insert()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  v_count INTEGER;
BEGIN
  IF NEW.type = 'electricity' AND NEW.system_key IS NOT NULL THEN
    SELECT COUNT(*) INTO v_count
      FROM products
      WHERE type = 'electricity'
        AND system_key IS NOT NULL;

    IF v_count >= 4 THEN
      RAISE EXCEPTION 'Cannot insert more than 4 system-defined electricity products (existing: %)', v_count
        USING ERRCODE = 'P0001';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_prevent_extra_system_product_insert
  BEFORE INSERT ON products
  FOR EACH ROW
  EXECUTE FUNCTION prevent_extra_system_product_insert();

-- Auto-update updated_at on row modification
CREATE OR REPLACE FUNCTION update_products_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_products_updated_at
  BEFORE UPDATE ON products
  FOR EACH ROW
  EXECUTE FUNCTION update_products_updated_at();
