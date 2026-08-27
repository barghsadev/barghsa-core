-- Migration 0030: Notification category model (T-05.05.01)
--
-- Separates transactional (mandatory) from marketing notifications and adds
-- per-profile, per-channel marketing consent preferences.
--
-- Creates:
--   1. notification_category enum type:
--        'mandatory_transactional' | 'marketing'
--   2. notification_categories lookup table (seeded with the two rows)
--        id, category (unique), is_marketing, description, created_at, updated_at
--   3. user_notification_preferences table — one row per (profile, channel)
--        profile_id (FK profiles.id, ON DELETE CASCADE)
--        channel ('email' | 'sms' | 'in_app')
--        marketing_opted_in (boolean, NOT NULL, DEFAULT false => marketing OFF)
--        consent_granted_at  (TIMESTAMPTZ, when user last opted in)
--        consent_revoked_at  (TIMESTAMPTZ, when user last opted out)
--        created_at / updated_at
--
-- Default is marketing OFF: a profile must explicitly opt in before any
-- marketing notification is delivered on that channel.
--
-- Constraints:
--   - uq_notification_categories_category: unique category value
--   - uq_user_notification_preferences_profile_channel: at most one preference
--     row per (profile_id, channel)
--   - check constraint on user_notification_preferences.channel
--
-- Rollback:
--   DROP TABLE IF EXISTS user_notification_preferences;
--   DROP TABLE IF EXISTS notification_categories;
--   DROP TYPE IF EXISTS notification_category;

-- ---------------------------------------------------------------------------
-- Create notification_category enum
-- ---------------------------------------------------------------------------
DO $$ BEGIN
  CREATE TYPE notification_category AS ENUM (
    'mandatory_transactional',
    'marketing'
  );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- ---------------------------------------------------------------------------
-- Create notification_categories lookup table
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS notification_categories (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v7(),
  category     notification_category NOT NULL,
  is_marketing BOOLEAN NOT NULL DEFAULT FALSE,
  description  TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_notification_categories_category
  ON notification_categories (category);

-- Seed the two categories (idempotent).
INSERT INTO notification_categories (category, is_marketing, description) VALUES
  ('mandatory_transactional', FALSE, 'Transactional/security notifications always delivered; never consent-gated.'),
  ('marketing', TRUE, 'Promotional notifications gated behind explicit opt-in consent.')
ON CONFLICT (category) DO NOTHING;

-- ---------------------------------------------------------------------------
-- Create user_notification_preferences table
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS user_notification_preferences (
  id                  UUID PRIMARY KEY DEFAULT uuid_generate_v7(),
  profile_id          UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  channel             TEXT NOT NULL,
  marketing_opted_in  BOOLEAN NOT NULL DEFAULT FALSE,
  consent_granted_at  TIMESTAMPTZ,
  consent_revoked_at  TIMESTAMPTZ,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE user_notification_preferences
  ADD CONSTRAINT chk_unp_channel
  CHECK (channel IN ('email', 'sms', 'in_app'));

CREATE UNIQUE INDEX IF NOT EXISTS uq_user_notification_preferences_profile_channel
  ON user_notification_preferences (profile_id, channel);

CREATE INDEX IF NOT EXISTS idx_unp_channel
  ON user_notification_preferences (channel);

CREATE INDEX IF NOT EXISTS idx_unp_marketing_opted_in
  ON user_notification_preferences (marketing_opted_in);

-- ---------------------------------------------------------------------------
-- Triggers: auto-update updated_at on row modification
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION update_notification_categories_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_nc_updated_at ON notification_categories;
CREATE TRIGGER trg_nc_updated_at
  BEFORE UPDATE ON notification_categories
  FOR EACH ROW
  EXECUTE FUNCTION update_notification_categories_updated_at();

CREATE OR REPLACE FUNCTION update_user_notification_preferences_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_unp_updated_at ON user_notification_preferences;
CREATE TRIGGER trg_unp_updated_at
  BEFORE UPDATE ON user_notification_preferences
  FOR EACH ROW
  EXECUTE FUNCTION update_user_notification_preferences_updated_at();
