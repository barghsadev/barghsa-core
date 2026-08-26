-- Migration 0022: Add status and updated_at to cities (T-09.02.02)
--
-- The existing cities table was created by the seed script with only
-- id, province_id, name_fa, name_en, and created_at columns. This migration adds:
--   - status: city_status enum (active/inactive), default 'active'
--   - updated_at: TIMESTAMPTZ, automatically maintained by a trigger
--
-- Both columns are additive — no existing rows or queries are affected.
-- Default seeded cities get status='active'.
--
-- Rollback:
--   DROP TRIGGER IF EXISTS trg_cities_updated_at ON cities;
--   ALTER TABLE cities DROP COLUMN IF EXISTS updated_at;
--   ALTER TABLE cities DROP COLUMN IF EXISTS status;
--   DROP TYPE IF EXISTS city_status;

-- ---------------------------------------------------------------------------
-- Create city_status enum
-- ---------------------------------------------------------------------------
DO $$ BEGIN
  CREATE TYPE city_status AS ENUM ('active', 'inactive');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- ---------------------------------------------------------------------------
-- Add status column with default 'active'
-- ---------------------------------------------------------------------------
ALTER TABLE cities
  ADD COLUMN IF NOT EXISTS status city_status NOT NULL DEFAULT 'active';

-- ---------------------------------------------------------------------------
-- Add updated_at column
-- ---------------------------------------------------------------------------
ALTER TABLE cities
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();

-- ---------------------------------------------------------------------------
-- Unique constraint on (province_id, name_en) for duplicate detection
-- ---------------------------------------------------------------------------
CREATE UNIQUE INDEX IF NOT EXISTS uq_cities_province_name_en ON cities (province_id, name_en);

-- ---------------------------------------------------------------------------
-- Index for admin listing (ordering by updated_at desc)
-- ---------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_cities_status ON cities (status);

-- ---------------------------------------------------------------------------
-- Trigger: auto-update updated_at on row modification
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION update_cities_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_cities_updated_at ON cities;
CREATE TRIGGER trg_cities_updated_at
  BEFORE UPDATE ON cities
  FOR EACH ROW
  EXECUTE FUNCTION update_cities_updated_at();