-- Migration 0007: Create tos_versions table (T-04.01.01, T-04.01.02)
--
-- Stores versioned Terms of Service content in both Persian and English.
-- Only one version is active at a time. The active version is returned by
-- GET /api/tos/current and must be accepted during registration and
-- re-acceptance flows.
--
-- Rollback:
--   DROP TRIGGER IF EXISTS trg_tos_versions_updated_at ON tos_versions;
--   DROP INDEX IF EXISTS idx_tos_versions_is_active;
--   DROP INDEX IF EXISTS idx_tos_versions_version_id;
--   DROP TABLE IF EXISTS tos_versions;

CREATE TABLE IF NOT EXISTS tos_versions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v7(),
  version_id TEXT NOT NULL UNIQUE,
  content_fa TEXT NOT NULL,
  content_en TEXT NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT FALSE,
  published_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_tos_versions_is_active ON tos_versions(is_active);
CREATE INDEX IF NOT EXISTS idx_tos_versions_version_id ON tos_versions(version_id);

-- Auto-update updated_at on row modification
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_tos_versions_updated_at
  BEFORE UPDATE ON tos_versions
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();