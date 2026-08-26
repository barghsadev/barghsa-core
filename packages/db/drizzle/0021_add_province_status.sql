-- Migration 0021: Add status and updated_at to provinces (T-09.02.01)
--
-- The existing provinces table was created by the seed script with only
-- id, name_fa, name_en, and created_at columns. This migration adds:
--   - status: province_status enum (active/inactive), default 'active'
--   - updated_at: TIMESTAMPTZ, automatically maintained by a trigger
--
-- Both columns are additive — no existing rows or queries are affected.
-- Default seeded provinces get status='active'.
--
-- Rollback:
--   DROP TRIGGER IF EXISTS trg_provinces_updated_at ON provinces;
--   ALTER TABLE provinces DROP COLUMN IF EXISTS updated_at;
--   ALTER TABLE provinces DROP COLUMN IF EXISTS status;
--   DROP TYPE IF EXISTS province_status;

-- ---------------------------------------------------------------------------
-- Create province_status enum
-- ---------------------------------------------------------------------------
DO $$ BEGIN
  CREATE TYPE province_status AS ENUM ('active', 'inactive');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- ---------------------------------------------------------------------------
-- Add status column with default 'active'
-- ---------------------------------------------------------------------------
ALTER TABLE provinces
  ADD COLUMN IF NOT EXISTS status province_status NOT NULL DEFAULT 'active';

-- ---------------------------------------------------------------------------
-- Add updated_at column
-- ---------------------------------------------------------------------------
ALTER TABLE provinces
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();

-- ---------------------------------------------------------------------------
-- Index for admin listing (ordering by updated_at desc)
-- ---------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_provinces_status ON provinces (status);

-- ---------------------------------------------------------------------------
-- Trigger: auto-update updated_at on row modification
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION update_provinces_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_provinces_updated_at ON provinces;
CREATE TRIGGER trg_provinces_updated_at
  BEFORE UPDATE ON provinces
  FOR EACH ROW
  EXECUTE FUNCTION update_provinces_updated_at();