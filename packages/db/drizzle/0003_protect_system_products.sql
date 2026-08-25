-- Migration 0003: Protect system-defined electricity products (T-02.04.06)
--
-- Adds database-level constraints to the products table:
--   1. Prevent DELETE of rows where product_type = 'electricity' AND system_type IS NOT NULL
--   2. Prevent UPDATE of system_type on existing system-defined products
--   3. Prevent INSERT of additional product_type = 'electricity' rows with
--      system_type beyond the four defaults (thermal, green, free_market, energy_saving)
--
-- Admins can still activate/deactivate products and set prices.

-- -------------------------------------------------------------------------
-- Trigger function: prevent DELETE of system-defined products
-- -------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION prevent_system_product_delete()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF OLD.product_type = 'electricity' AND OLD.system_type IS NOT NULL THEN
    RAISE EXCEPTION 'Cannot delete system-defined electricity product (system_type: %)', OLD.system_type
      USING ERRCODE = 'P0001';
  END IF;
  RETURN OLD;
END;
$$;

CREATE TRIGGER trg_prevent_system_product_delete
  BEFORE DELETE ON products
  FOR EACH ROW
  EXECUTE FUNCTION prevent_system_product_delete();

-- -------------------------------------------------------------------------
-- Trigger function: prevent UPDATE of system_type on system products
-- -------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION prevent_system_type_change()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF OLD.system_type IS NOT NULL AND NEW.system_type IS DISTINCT FROM OLD.system_type THEN
    RAISE EXCEPTION 'Cannot change system_type of system-defined product (system_type: %)', OLD.system_type
      USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_prevent_system_type_change
  BEFORE UPDATE ON products
  FOR EACH ROW
  EXECUTE FUNCTION prevent_system_type_change();

-- -------------------------------------------------------------------------
-- Trigger function: prevent INSERT of extra system-defined products
-- -------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION prevent_extra_system_product_insert()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  v_count INTEGER;
BEGIN
  IF NEW.product_type = 'electricity' AND NEW.system_type IS NOT NULL THEN
    SELECT COUNT(*) INTO v_count
      FROM products
      WHERE product_type = 'electricity'
        AND system_type IS NOT NULL;

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