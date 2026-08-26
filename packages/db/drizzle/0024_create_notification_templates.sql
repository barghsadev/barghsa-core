-- Migration 0024: Create notification_templates table (T-09.04.01)
--
-- Stores editable notification templates for each event+channel+locale combo.
-- Versioned (mirrors brand_config pattern): each publish increments `version`
-- and the previous active template is preserved as an archived historical row,
-- so published content history is retained.
--
-- Columns:
--   - id: UUIDv7 PK (Drizzle base)
--   - created_at / updated_at: TIMESTAMPTZ (Drizzle base)
--   - event_key: TEXT not null — event that triggers the notification
--   - channel: TEXT not null, check in ('email','sms','in_app')
--   - locale: TEXT not null, check in ('fa','en')
--   - subject: TEXT nullable — email subject (email channel only)
--   - body_template: TEXT not null — body with {{variable}} placeholders
--   - variables: JSONB not null default '[]' — allow-listed variable names
--   - status: TEXT not null default 'draft' — draft | active | archived
--   - is_active: BOOLEAN not null default false
--   - version: INTEGER not null default 1 — increments on each publish
--   - published_at: TIMESTAMPTZ nullable
--   - created_by: TEXT FK to users.user_id ON DELETE SET NULL (last editor)
--
-- Constraints:
--   - uq_notification_templates_active: partial unique index so at most one
--     ACTIVE template exists per (event_key, channel, locale).
--   - check constraints on channel, locale, status.
--
-- Rollback:
--   DROP TABLE IF EXISTS notification_templates;

-- ---------------------------------------------------------------------------
-- Create notification_templates table
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS notification_templates (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v7(),
  event_key     TEXT NOT NULL,
  channel       TEXT NOT NULL,
  locale        TEXT NOT NULL,
  subject       TEXT,
  body_template TEXT NOT NULL,
  variables     JSONB NOT NULL DEFAULT '[]'::jsonb,
  status        TEXT NOT NULL DEFAULT 'draft',
  is_active     BOOLEAN NOT NULL DEFAULT FALSE,
  version       INTEGER NOT NULL DEFAULT 1,
  published_at  TIMESTAMPTZ,
  created_by    TEXT REFERENCES users(user_id) ON DELETE SET NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ---------------------------------------------------------------------------
-- At most one active template per event+channel+locale combo
-- ---------------------------------------------------------------------------
CREATE UNIQUE INDEX IF NOT EXISTS uq_notification_templates_active
  ON notification_templates (event_key, channel, locale)
  WHERE is_active = true;

-- ---------------------------------------------------------------------------
-- Check constraints
-- ---------------------------------------------------------------------------
ALTER TABLE notification_templates
  ADD CONSTRAINT chk_nt_channel CHECK (channel IN ('email', 'sms', 'in_app'));

ALTER TABLE notification_templates
  ADD CONSTRAINT chk_nt_locale CHECK (locale IN ('fa', 'en'));

ALTER TABLE notification_templates
  ADD CONSTRAINT chk_nt_status CHECK (status IN ('draft', 'active', 'archived'));

-- ---------------------------------------------------------------------------
-- Indexes for admin listing
-- ---------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_nt_event_channel_locale
  ON notification_templates (event_key, channel, locale);
CREATE INDEX IF NOT EXISTS idx_nt_status ON notification_templates (status);
CREATE INDEX IF NOT EXISTS idx_nt_created_by ON notification_templates (created_by);

-- ---------------------------------------------------------------------------
-- Trigger: auto-update updated_at on row modification
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION update_notification_templates_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_nt_updated_at ON notification_templates;
CREATE TRIGGER trg_nt_updated_at
  BEFORE UPDATE ON notification_templates
  FOR EACH ROW
  EXECUTE FUNCTION update_notification_templates_updated_at();
