-- Migration 0009: Add archived/deleted_at columns to profiles (T-05.02.06)
--
-- Adds soft-delete support to the profiles table. When a profile is
-- "deleted" by staff, it is archived rather than removed. Archived
-- profiles are excluded from normal queries but retained for GDPR
-- retention and audit purposes.
--
-- Rollback:
--   ALTER TABLE profiles DROP COLUMN IF EXISTS archived;
--   ALTER TABLE profiles DROP COLUMN IF EXISTS archived_at;
--   ALTER TABLE profiles DROP COLUMN IF EXISTS archived_reason;
--   DROP INDEX IF EXISTS idx_profiles_archived;

ALTER TABLE profiles
ADD COLUMN IF NOT EXISTS archived BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE profiles
ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ;

ALTER TABLE profiles
ADD COLUMN IF NOT EXISTS archived_reason TEXT;

CREATE INDEX IF NOT EXISTS idx_profiles_archived
  ON profiles (archived)
  WHERE archived = true;