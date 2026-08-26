-- Migration 0020: Create brand_config table for admin branding settings (T-09.01.01)
--
-- Stores brand configuration as a JSON document with Draft → Active lifecycle.
-- A single active config is always present; drafts are created by duplicating
-- the active config and modified independently.
--
-- Columns (from createTable base):
--   - id: UUIDv7 PK (from Drizzle base columns)
--   - created_at / updated_at: TIMESTAMPTZ (from base columns)
-- Domain columns:
--   - config: JSONB, not null — stores logo CdnUrl, primaryColor, secondaryColor,
--     accentColor, appTitle, slogan, favicon, etc.
--   - version: INTEGER, not null, default 1 — monotonically increasing per brand
--   - status: brand_config_status enum, not null, default 'draft' — Draft or Active
--   - created_by: TEXT, not null — user ID who created/modified this version
--
-- Rollback:
--   DROP TABLE IF EXISTS brand_config;
--   DROP TYPE IF EXISTS brand_config_status;

-- ---------------------------------------------------------------------------
-- Create brand_config_status enum
-- ---------------------------------------------------------------------------
DO $$ BEGIN
  CREATE TYPE brand_config_status AS ENUM ('draft', 'active');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- ---------------------------------------------------------------------------
-- Create brand_config table
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS brand_config (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  config      JSONB NOT NULL DEFAULT '{}'::jsonb,
  version     INTEGER NOT NULL DEFAULT 1,
  status      brand_config_status NOT NULL DEFAULT 'draft',
  created_by  TEXT NOT NULL
);

-- Enforce at most one active config at any time
CREATE UNIQUE INDEX IF NOT EXISTS uq_brand_config_active
  ON brand_config (status) WHERE status = 'active';

-- Index for listing configs ordered by version
CREATE INDEX IF NOT EXISTS idx_brand_config_version
  ON brand_config (version DESC);

-- ---------------------------------------------------------------------------
-- Trigger: auto-update updated_at on row modification
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION update_brand_config_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_brand_config_updated_at ON brand_config;
CREATE TRIGGER trg_brand_config_updated_at
  BEFORE UPDATE ON brand_config
  FOR EACH ROW
  EXECUTE FUNCTION update_brand_config_updated_at();

-- ---------------------------------------------------------------------------
-- Seed: create a default draft config (no active config yet)
-- ---------------------------------------------------------------------------
INSERT INTO brand_config (config, version, status, created_by)
SELECT
  '{
    "appTitle": "Barghsa",
    "slogan": "",
    "primaryColor": "#2563eb",
    "secondaryColor": "#64748b",
    "accentColor": "#f59e0b",
    "logoUrl": null,
    "faviconUrl": null,
    "darkMode": false
  }'::jsonb,
  1,
  'draft',
  'system'
WHERE NOT EXISTS (SELECT 1 FROM brand_config);