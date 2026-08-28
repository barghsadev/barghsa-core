-- Migration 0048: Gift codes (T-09.12.03)
--
-- Admin-managed gift codes redeemed at order creation. Code is stored
-- normalized (trim + uppercase) with a UNIQUE index so `sale10` and
-- ` SALE10 ` collide.
--
-- gift_codes:
--   id                UUIDv7 PK
--   code              TEXT — normalized (trim + uppercase), UNIQUE
--   discount_type     TEXT — 'fixed_irr' | 'percentage'
--   discount_value    BIGINT — IRR amount (fixed_irr) or basis points
--                     (percentage, 1..10000; 2500 = 25%)
--   max_cap_irr       BIGINT — REQUIRED for percentage; NULL for fixed
--   eligibility       TEXT — 'public' | 'profile' (default public)
--   total_limit       INTEGER — total redemptions; NULL = unlimited
--   per_profile_limit INTEGER — per-profile redemptions; NULL = unlimited
--   valid_from        TIMESTAMPTZ — window start (inclusive)
--   valid_until       TIMESTAMPTZ — window end (exclusive), NULL = open
--   min_order_amount  BIGINT — minimum order total in IRR; 0 = none
--   categories        TEXT[] — eligible product categories; '{}' = all
--   status            TEXT — 'active' | 'inactive' (default active)
--   created_by        TEXT FK users.user_id ON DELETE RESTRICT
--   created_at / updated_at (base columns)
--
-- gift_code_profiles — profile-restricted eligibility (join):
--   (gift_code_id, profile_id) PK; CASCADE on either side (config, not
--   history). Rows exist only when gift_codes.eligibility = 'profile'.
--
-- gift_code_redemptions — redemption ledger (history, never deleted):
--   id               UUIDv7 PK
--   gift_code_id     UUID FK gift_codes.id ON DELETE RESTRICT
--   profile_id       UUID FK profiles.id ON DELETE RESTRICT
--   order_id         UUID FK orders.id ON DELETE RESTRICT, UNIQUE
--                    (at most one gift code per order — this is the
--                    authoritative order<->code association)
--   discount_amount  BIGINT — exact IRR discount applied at redemption
--   status           TEXT — 'consumed' (counts) | 'released' (restored
--                    on cancellation before payment)
--   created_at       (base column)
--
-- Guarantees:
--   - discount CHECKs: fixed_irr has no cap; percentage is within
--     1..10000 bps and REQUIRES a positive cap;
--   - window CHECK valid_until NULL or after valid_from;
--   - limit CHECKs > 0 when set; min_order_amount >= 0;
--   - UNIQUE normalized code; UNIQUE redemption.order_id;
--   - updated_at triggers.
--
-- Rollback:
--   DROP TABLE IF EXISTS gift_code_redemptions CASCADE;
--   DROP TABLE IF EXISTS gift_code_profiles CASCADE;
--   DROP TABLE IF EXISTS gift_codes CASCADE;

-- ---------------------------------------------------------------------------
-- gift_codes
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS gift_codes (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v7(),
  code TEXT NOT NULL,
  discount_type TEXT NOT NULL,
  discount_value BIGINT NOT NULL,
  max_cap_irr BIGINT,
  eligibility TEXT NOT NULL DEFAULT 'public',
  total_limit INTEGER,
  per_profile_limit INTEGER,
  valid_from TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  valid_until TIMESTAMPTZ,
  min_order_amount BIGINT NOT NULL DEFAULT 0,
  categories TEXT[] NOT NULL DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'active',
  created_by TEXT NOT NULL REFERENCES users(user_id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE gift_codes
  ADD CONSTRAINT chk_gift_codes_discount_type
  CHECK (discount_type IN ('fixed_irr', 'percentage'));

ALTER TABLE gift_codes
  ADD CONSTRAINT chk_gift_codes_eligibility
  CHECK (eligibility IN ('public', 'profile'));

ALTER TABLE gift_codes
  ADD CONSTRAINT chk_gift_codes_status
  CHECK (status IN ('active', 'inactive'));

ALTER TABLE gift_codes
  ADD CONSTRAINT chk_gift_codes_discount_value
  CHECK (
    discount_value > 0
    AND (
      (discount_type = 'fixed_irr' AND max_cap_irr IS NULL)
      OR
      (discount_type = 'percentage'
       AND discount_value <= 10000
       AND max_cap_irr IS NOT NULL
       AND max_cap_irr > 0)
    )
  );

ALTER TABLE gift_codes
  ADD CONSTRAINT chk_gift_codes_window
  CHECK (valid_until IS NULL OR valid_from < valid_until);

ALTER TABLE gift_codes
  ADD CONSTRAINT chk_gift_codes_limits
  CHECK (
    (total_limit IS NULL OR total_limit > 0)
    AND (per_profile_limit IS NULL OR per_profile_limit > 0)
  );

ALTER TABLE gift_codes
  ADD CONSTRAINT chk_gift_codes_min_order
  CHECK (min_order_amount >= 0);

CREATE UNIQUE INDEX IF NOT EXISTS uq_gift_codes_code
  ON gift_codes (code);
CREATE INDEX IF NOT EXISTS idx_gift_codes_status
  ON gift_codes (status);
CREATE INDEX IF NOT EXISTS idx_gift_codes_valid_from
  ON gift_codes (valid_from);
CREATE INDEX IF NOT EXISTS idx_gift_codes_valid_until
  ON gift_codes (valid_until);

-- ---------------------------------------------------------------------------
-- gift_code_profiles (profile-restricted eligibility)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS gift_code_profiles (
  gift_code_id UUID NOT NULL REFERENCES gift_codes(id) ON DELETE CASCADE,
  profile_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  PRIMARY KEY (gift_code_id, profile_id)
);

CREATE INDEX IF NOT EXISTS idx_gift_code_profiles_profile_id
  ON gift_code_profiles (profile_id);

-- ---------------------------------------------------------------------------
-- gift_code_redemptions (redemption ledger)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS gift_code_redemptions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v7(),
  gift_code_id UUID NOT NULL REFERENCES gift_codes(id) ON DELETE RESTRICT,
  profile_id UUID NOT NULL REFERENCES profiles(id) ON DELETE RESTRICT,
  order_id UUID NOT NULL REFERENCES orders(id) ON DELETE RESTRICT,
  discount_amount BIGINT NOT NULL,
  status TEXT NOT NULL DEFAULT 'consumed',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE gift_code_redemptions
  ADD CONSTRAINT chk_gift_code_redemptions_status
  CHECK (status IN ('consumed', 'released'));

CREATE UNIQUE INDEX IF NOT EXISTS uq_gift_code_redemptions_order_id
  ON gift_code_redemptions (order_id);
CREATE INDEX IF NOT EXISTS idx_gift_code_redemptions_code_status
  ON gift_code_redemptions (gift_code_id, status);
CREATE INDEX IF NOT EXISTS idx_gift_code_redemptions_code_profile_status
  ON gift_code_redemptions (gift_code_id, profile_id, status);

-- ---------------------------------------------------------------------------
-- orders — gift-code mirror columns (T-09.12.03)
--
-- The Drizzle schema (schema/orders.ts) declares `gift_code_id` (uuid,
-- no FK — the authoritative link lives in gift_code_redemptions.order_id)
-- and `gift_discount_amount` (bigint). They must be added HERE for the
-- orders module's gift-code integration to work on a real database.
-- Both are nullable, so the expand is backward compatible.
-- ---------------------------------------------------------------------------
ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS gift_code_id UUID;

ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS gift_discount_amount BIGINT;

CREATE INDEX IF NOT EXISTS idx_orders_gift_code_id
  ON orders (gift_code_id);

-- ---------------------------------------------------------------------------
-- updated_at triggers
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION update_gift_codes_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_gift_codes_updated_at
  BEFORE UPDATE ON gift_codes
  FOR EACH ROW
  EXECUTE FUNCTION update_gift_codes_updated_at();
