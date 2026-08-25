-- Migration 0006: Create orders table (T-03.04.02)
--
-- Stores order records with address snapshots (values copied, not FK)
-- to ensure historical accuracy if the user's saved address changes later.
--
-- Rollback:
--   DROP TABLE IF EXISTS orders;
--   DROP INDEX IF EXISTS idx_orders_user_id;
--   DROP INDEX IF EXISTS idx_orders_profile_id;
--   DROP INDEX IF EXISTS idx_orders_product_id;
--   DROP INDEX IF EXISTS idx_orders_status;

CREATE TABLE IF NOT EXISTS orders (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v7(),
  user_id TEXT NOT NULL REFERENCES users(user_id) ON DELETE RESTRICT,
  profile_id UUID NOT NULL REFERENCES profiles(id) ON DELETE RESTRICT,
  product_id UUID NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
  order_type TEXT NOT NULL CHECK (order_type IN ('electricity', 'savings', 'solar')),
  status TEXT NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT', 'PENDING', 'CONFIRMED', 'CANCELLED')),
  snapshot_province_id TEXT NOT NULL,
  snapshot_city_id TEXT NOT NULL,
  snapshot_full_address TEXT NOT NULL,
  snapshot_postal_code TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_orders_user_id ON orders(user_id);
CREATE INDEX IF NOT EXISTS idx_orders_profile_id ON orders(profile_id);
CREATE INDEX IF NOT EXISTS idx_orders_product_id ON orders(product_id);
CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status);

-- Auto-update updated_at on row modification
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_orders_updated_at
  BEFORE UPDATE ON orders
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();