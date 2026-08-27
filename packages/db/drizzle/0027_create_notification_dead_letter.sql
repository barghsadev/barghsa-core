-- Migration 0027: Create notification_dead_letter table (T-05.01.06)
--
-- Dead-letter queue. The outbox worker writes one row when a notification_job
-- exhausts its retry budget (status -> 'dead_letter'), inheriting the failed
-- delivery context so the admin panel can triage without chasing tables.
--
-- Columns:
--   id              UUIDv7 PK
--   outbox_id       UUID FK -> notification_outbox(id) ON DELETE CASCADE
--   job_id          UUID FK -> notification_job(id) ON DELETE CASCADE
--   channel         TEXT NOT NULL CHECK in ('in_app','email','sms')
--   event_key       TEXT NOT NULL (business event key for template lookup)
--   severity        TEXT CHECK in ('error','critical') DEFAULT 'error'
--   profile_id      UUID (recipient profile)
--   user_id         TEXT (recipient user id for in-app)
--   cause           TEXT (sanitized final error message)
--   error_category  TEXT CHECK in ('transient','permanent','provider')
--   attempts        INT NOT NULL DEFAULT 0
--   max_attempts    INT NOT NULL DEFAULT 5
--   idempotency_key TEXT NOT NULL (reused on retry, at-most-once)
--   status          TEXT CHECK in ('open','retried','resolved','dismissed')
--                   DEFAULT 'open'
--   resolved_at     TIMESTAMPTZ
--   resolved_by     TEXT
--   created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
--   updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
--
-- Indexes target the ops-panel query shapes: open items newest-first, severity
-- triage, and per-outbox lookup.
--
-- Rollback:
--   DROP TABLE IF EXISTS notification_dead_letter;

-- ---------------------------------------------------------------------------
-- Create notification_dead_letter table
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS notification_dead_letter (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v7(),
  outbox_id       UUID NOT NULL REFERENCES notification_outbox(id) ON DELETE CASCADE,
  job_id          UUID NOT NULL REFERENCES notification_job(id) ON DELETE CASCADE,
  channel         TEXT NOT NULL,
  event_key       TEXT NOT NULL,
  severity        TEXT NOT NULL DEFAULT 'error',
  profile_id      UUID,
  user_id         TEXT,
  cause           TEXT,
  error_category  TEXT,
  attempts        INTEGER NOT NULL DEFAULT 0,
  max_attempts    INTEGER NOT NULL DEFAULT 5,
  idempotency_key TEXT NOT NULL,
  status          TEXT NOT NULL DEFAULT 'open',
  resolved_at     TIMESTAMPTZ,
  resolved_by     TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT chk_ndl_channel CHECK (channel IN ('in_app', 'email', 'sms')),
  CONSTRAINT chk_ndl_severity CHECK (severity IN ('error', 'critical')),
  CONSTRAINT chk_ndl_error_category CHECK (error_category IN ('transient', 'permanent', 'provider')),
  CONSTRAINT chk_ndl_status CHECK (status IN ('open', 'retried', 'resolved', 'dismissed'))
);

-- Ops panel default query (open items newest-first).
CREATE INDEX IF NOT EXISTS idx_ndl_status_created
  ON notification_dead_letter (status, created_at DESC);

-- Triage by severity across all statuses.
CREATE INDEX IF NOT EXISTS idx_ndl_severity
  ON notification_dead_letter (severity);

-- Lookup a single notification's dead-letter history.
CREATE INDEX IF NOT EXISTS idx_ndl_outbox
  ON notification_dead_letter (outbox_id);