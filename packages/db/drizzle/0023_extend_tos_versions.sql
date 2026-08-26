-- Migration 0023: Extend tos_versions with TOS editor columns (T-09.03.01)
--
-- The existing tos_versions table had only id, version_id, content_fa, content_en,
-- is_active, published_at, created_at, and updated_at. This migration adds:
--   - change_type: text ('major' | 'minor'), default 'minor' for existing rows
--   - status: text ('draft' | 'published'), default 'published' for existing rows
--   - created_by: text FK to users.user_id, nullable (existing rows get null)
--   - published_at is now nullable (null for draft versions)
--
-- Rollback:
--   ALTER TABLE tos_versions DROP COLUMN IF EXISTS created_by;
--   ALTER TABLE tos_versions DROP COLUMN IF EXISTS status;
--   ALTER TABLE tos_versions DROP COLUMN IF EXISTS change_type;
--   ALTER TABLE tos_versions ALTER COLUMN published_at SET NOT NULL;

-- ---------------------------------------------------------------------------
-- Add change_type column — existing published versions are 'minor'
-- ---------------------------------------------------------------------------
ALTER TABLE tos_versions
  ADD COLUMN IF NOT EXISTS change_type text NOT NULL DEFAULT 'minor';

-- ---------------------------------------------------------------------------
-- Add status column — existing rows (all were published) get 'published'
-- ---------------------------------------------------------------------------
ALTER TABLE tos_versions
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'published';

-- ---------------------------------------------------------------------------
-- Add created_by FK to users — nullable for existing rows
-- ---------------------------------------------------------------------------
ALTER TABLE tos_versions
  ADD COLUMN IF NOT EXISTS created_by text REFERENCES users(user_id) ON DELETE SET NULL;

-- ---------------------------------------------------------------------------
-- Make published_at nullable (draft versions don't have a publish date)
-- ---------------------------------------------------------------------------
ALTER TABLE tos_versions
  ALTER COLUMN published_at DROP NOT NULL;

-- ---------------------------------------------------------------------------
-- Add check constraints
-- ---------------------------------------------------------------------------
ALTER TABLE tos_versions
  ADD CONSTRAINT chk_tos_change_type CHECK (change_type IN ('major', 'minor'));

ALTER TABLE tos_versions
  ADD CONSTRAINT chk_tos_status CHECK (status IN ('draft', 'published'));

-- ---------------------------------------------------------------------------
-- Only published versions can be active
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION check_tos_active_on_published()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.is_active = true AND NEW.status != 'published' THEN
    RAISE EXCEPTION 'Only published versions can be set as active';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_tos_active_on_published ON tos_versions;
CREATE TRIGGER trg_tos_active_on_published
  BEFORE INSERT OR UPDATE ON tos_versions
  FOR EACH ROW
  EXECUTE FUNCTION check_tos_active_on_published();

-- ---------------------------------------------------------------------------
-- Index for admin listing
-- ---------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_tos_versions_status ON tos_versions (status);
CREATE INDEX IF NOT EXISTS idx_tos_versions_created_by ON tos_versions (created_by);