-- Migration 0026: Create notification_delivery_log table (T-05.01.05)
--
-- Append-only audit trail of every delivery attempt performed by the outbox
-- worker. One row per (notification, channel, attempt). Powers the admin
-- panel's delivery-history views and operational triage.
--
-- Columns:
--   id             UUIDv7 PK
--   notification_id UUID FK -> notification_outbox(id) ON DELETE CASCADE
--   channel        TEXT NOT NULL CHECK in ('in_app','email','sms')
--   status         TEXT NOT NULL CHECK in ('delivered','failed')
--   attempt_number INTEGER NOT NULL (1-based within the channel's job)
--   provider_ref   TEXT (real provider ref returned by the transport)
--   latency_ms     INTEGER (provider round-trip latency, when measurable)
--   error_category TEXT CHECK in ('transient','permanent','provider')
--   error_detail   TEXT (sanitized — never leaks credentials)
--   created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
--
-- Indexes target the admin query shapes: by notification, by channel+status
-- (failure triage), and newest-first pagination.
--
-- Rollback:
--   DROP TABLE IF EXISTS notification_delivery_log;

-- ---------------------------------------------------------------------------
-- Create notification_delivery_log table
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS notification_delivery_log (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v7(),
  notification_id UUID NOT NULL REFERENCES notification_outbox(id) ON DELETE CASCADE,
  channel         TEXT NOT NULL,
  status          TEXT NOT NULL,
  attempt_number  INTEGER NOT NULL,
  provider_ref    TEXT,
  latency_ms      INTEGER,
  error_category  TEXT,
  error_detail    TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT chk_ndl_channel CHECK (channel IN ('in_app', 'email', 'sms')),
  CONSTRAINT chk_ndl_status CHECK (status IN ('delivered', 'failed')),
  CONSTRAINT chk_ndl_error_category CHECK (error_category IN ('transient', 'permanent', 'provider'))
);

-- Admin queries by notification id, newest-first.
CREATE INDEX IF NOT EXISTS idx_ndl_notification
  ON notification_delivery_log (notification_id, created_at DESC);

-- Failure triage: which channels / statuses have been failing.
CREATE INDEX IF NOT EXISTS idx_ndl_channel_status
  ON notification_delivery_log (channel, status);

-- Newest-first pagination across the whole table.
CREATE INDEX IF NOT EXISTS idx_ndl_created
  ON notification_delivery_log (created_at DESC);