-- Migration 0028: Create in_app_notifications table (T-05.02.01)
--
-- In-app notification center storage (E-05, Story T-05.02). One row per
-- notification shown in a user's in-app notification center. Written
-- synchronously by the in-app transport adapter when the outbox worker
-- dispatches an `in_app` channel, so an in-app notification is durable the
-- moment its business event fires (no external provider round-trip).
--
-- The table is intentionally append-only for the bulk of its life: the only
-- mutable column is `is_read` / `read_at`, flipped by the notification-center
-- API (T-05.02.02). `updated_at` from the shared base columns is deliberately
-- omitted because it would never change; `created_at` is the only lifecycle
-- timestamp of record.
--
-- Columns:
--   id             UUIDv7 PK
--   profile_id     UUID NOT NULL FK -> profiles(id)  (recipient)
--   type           TEXT NOT NULL — notification/event type (e.g. an event key
--                  such as 'profile_verified'); drives iconography & routing.
--   title_i18n_key TEXT NOT NULL — i18n key for the title. Derived from the
--                  event type by the in-app transport; concrete strings come
--                  from the locale dictionaries (fa/en) rendered by the UI.
--   body_i18n_key  TEXT NOT NULL — i18n key for the body text.
--   params         JSONB NOT NULL DEFAULT '{}' — interpolation variables used
--                  to render placeholders inside title/body.
--   link_route     TEXT — deep-link route (e.g. '/app/orders/:id') to open
--                  when the notification is clicked.
--   link_params    JSONB — parameters merged into the link route.
--   is_read        BOOLEAN NOT NULL DEFAULT false
--   read_at        TIMESTAMPTZ — when the recipient read it (NULL until read).
--   created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
--
-- Index: (profile_id, created_at DESC) — the notification-center queries load
-- a profile's notifications newest-first (cursor pagination, T-05.02.02).
--
-- Rollback:
--   DROP TABLE IF EXISTS in_app_notifications;

CREATE TABLE IF NOT EXISTS in_app_notifications (
  id             UUID PRIMARY KEY DEFAULT uuid_generate_v7(),
  profile_id     UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  type           TEXT NOT NULL,
  title_i18n_key TEXT NOT NULL,
  body_i18n_key  TEXT NOT NULL,
  params         JSONB NOT NULL DEFAULT '{}'::jsonb,
  link_route     TEXT,
  link_params    JSONB,
  is_read        BOOLEAN NOT NULL DEFAULT false,
  read_at        TIMESTAMPTZ,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Notification-center list query: a profile's notifications newest-first.
CREATE INDEX IF NOT EXISTS idx_ian_profile_created
  ON in_app_notifications (profile_id, created_at DESC);
