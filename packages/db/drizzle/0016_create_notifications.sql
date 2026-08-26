-- Migration 0016: Create notifications table for in-app notification stub (T-07.01.03)
--
-- Lightweight in-app notification store. The full notification infrastructure
-- (email/SMS transport, outbox, worker, delivery service) belongs to E-05.
-- This table provides enough storage for in-app notifications used by
-- verification status changes and similar E-02 events.
--
-- Columns (from createTable base):
--   - id: UUIDv7 PK (from Drizzle base columns)
--   - created_at / updated_at: TIMESTAMPTZ (from base columns)
-- Domain columns:
--   - user_id: TEXT, FK to users.user_id, ON DELETE CASCADE
--   - profile_id: TEXT, nullable FK to profiles.id, ON DELETE SET NULL
--   - type: notification_type enum
--   - title: TEXT, not null
--   - body: TEXT, nullable
--   - link: TEXT, nullable — relative URL for deep-linking
--   - read: BOOLEAN, default false
--   - read_at: TIMESTAMPTZ, nullable
--
-- Rollback:
--   DROP TABLE IF EXISTS notifications;
--   DROP TYPE IF EXISTS notification_type;

-- ---------------------------------------------------------------------------
-- Create notification_type enum
-- ---------------------------------------------------------------------------
DO $$ BEGIN
  CREATE TYPE notification_type AS ENUM (
    'verification_status',
    'profile_verified',
    'profile_unverified',
    'profile_pending',
    'general'
  );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- ---------------------------------------------------------------------------
-- Create notifications table
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS notifications (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v7(),
  user_id TEXT NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  profile_id UUID REFERENCES profiles(id) ON DELETE SET NULL,
  type notification_type NOT NULL DEFAULT 'general',
  title TEXT NOT NULL,
  body TEXT,
  link TEXT,
  read BOOLEAN NOT NULL DEFAULT false,
  read_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ---------------------------------------------------------------------------
-- Indexes
-- ---------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_notifications_user_id
  ON notifications (user_id);
CREATE INDEX IF NOT EXISTS idx_notifications_user_unread
  ON notifications (user_id, read)
  WHERE read = false;
CREATE INDEX IF NOT EXISTS idx_notifications_created_at
  ON notifications (created_at DESC);

-- ---------------------------------------------------------------------------
-- Trigger: auto-update updated_at on row modification
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION update_notifications_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_notifications_updated_at
  BEFORE UPDATE ON notifications
  FOR EACH ROW
  EXECUTE FUNCTION update_notifications_updated_at();
