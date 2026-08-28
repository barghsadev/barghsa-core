-- Migration 0047: VAT configurations + product overrides (T-09.12.02)
--
-- Versioned VAT rates administered per charge category, with optional
-- per-product overrides. Resolution order (T-09.12.02 / T-03.02.05.03):
--   product override > category default > 0% fallback.
--
-- vat_configurations (one row = one versioned rate):
--   id               UUIDv7 PK
--   category         TEXT — charge category key (canonical set in
--                    @barghsa/shared/finance CHARGE_CATEGORIES; the
--                    reserved 'product_override' key holds product-
--                    specific rates reachable only via overrides)
--   rate             INTEGER — basis points (900 = 9.00%), CHECK 0..10000
--   effective_from   TIMESTAMPTZ — window start (inclusive)
--   effective_until  TIMESTAMPTZ — window end (exclusive), null = open
--   created_by       TEXT FK users.user_id ON DELETE RESTRICT
--   created_at / updated_at (base columns)
--
-- product_vat_overrides:
--   id               UUIDv7 PK
--   product_id       UUID FK products.id ON DELETE RESTRICT
--   vat_config_id    UUID FK vat_configurations.id ON DELETE RESTRICT
--   effective_from / effective_until — override window (same semantics)
--   created_by       TEXT FK users.user_id ON DELETE RESTRICT
--   created_at / updated_at (base columns)
--
-- Guarantees:
--   - rate within 0..10000 bps (0%..100%);
--   - effective_until null or strictly after effective_from;
--   - GIST EXCLUDE: no overlapping windows per category (and per
--     product for overrides) — at most one open row per key;
--   - updated_at maintained by trigger.
--
-- Rollback:
--   DROP TABLE IF EXISTS product_vat_overrides CASCADE;
--   DROP TABLE IF EXISTS vat_configurations CASCADE;

-- ---------------------------------------------------------------------------
-- vat_configurations
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS vat_configurations (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v7(),
  category TEXT NOT NULL,
  rate INTEGER NOT NULL,
  effective_from TIMESTAMPTZ NOT NULL,
  effective_until TIMESTAMPTZ,
  created_by TEXT NOT NULL REFERENCES users(user_id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE vat_configurations
  ADD CONSTRAINT chk_vat_configurations_rate_range
  CHECK (rate BETWEEN 0 AND 10000);

ALTER TABLE vat_configurations
  ADD CONSTRAINT chk_vat_configurations_effective_range
  CHECK (effective_until IS NULL OR effective_from < effective_until);

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
CREATE INDEX IF NOT EXISTS idx_vat_configurations_effective_until
  ON vat_configurations (effective_until);

-- ---------------------------------------------------------------------------
-- product_vat_overrides
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS product_vat_overrides (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v7(),
  product_id UUID NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
  vat_config_id UUID NOT NULL REFERENCES vat_configurations(id) ON DELETE RESTRICT,
  effective_from TIMESTAMPTZ NOT NULL,
  effective_until TIMESTAMPTZ,
  created_by TEXT NOT NULL REFERENCES users(user_id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE product_vat_overrides
  ADD CONSTRAINT chk_product_vat_overrides_effective_range
  CHECK (effective_until IS NULL OR effective_from < effective_until);

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

-- ---------------------------------------------------------------------------
-- updated_at triggers
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION update_vat_configurations_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_vat_configurations_updated_at
  BEFORE UPDATE ON vat_configurations
  FOR EACH ROW
  EXECUTE FUNCTION update_vat_configurations_updated_at();

CREATE OR REPLACE FUNCTION update_product_vat_overrides_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_product_vat_overrides_updated_at
  BEFORE UPDATE ON product_vat_overrides
  FOR EACH ROW
  EXECUTE FUNCTION update_product_vat_overrides_updated_at();
