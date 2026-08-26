-- Migration 0025: Create notification outbox & job queue tables (T-05.01.01)
--
-- Durable notification delivery infrastructure (E-05). Two tables:
--
--   notification_outbox — the transactional outbox. Business events write a
--     row in the same DB transaction as the business state change, so delivery
--     intent survives crashes. A worker leases rows and dispatches channels.
--
--   notification_job — per-channel dispatch queue with bounded retry schedule,
--     priority (urgent vs normal), and dead-letter transition (T-05.01.03).
--
-- Columns:
--   outbox: id (UUIDv7), profile_id FK, user_id FK, event_key, payload (JSONB),
--     channels (text[]), status ('queued'|'scheduled'|'sending'|'delivered'|
--     'failed'|'cancelled'), idempotency_key (UNIQUE for T-05.01.04),
--     locked_until (lease), attempts, max_attempts, last_error, provider_ref,
--     scheduled_for, created_at, updated_at.
--
--   job: id, outbox_id FK, channel ('in_app'|'email'|'sms'), status
--     ('queued'|'running'|'retrying'|'done'|'failed'|'dead_letter'),
--     priority ('urgent'|'normal'), attempts, max_attempts, run_after,
--     last_error, created_at, updated_at. UNIQUE (outbox_id, channel).
--
-- Rollback:
--   DROP TABLE IF EXISTS notification_job;
--   DROP TABLE IF EXISTS notification_outbox;

-- ---------------------------------------------------------------------------
-- Create notification_outbox table
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS notification_outbox (
  id               UUID PRIMARY KEY DEFAULT uuid_generate_v7(),
  profile_id       UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  user_id          TEXT REFERENCES users(user_id) ON DELETE CASCADE,
  event_key        TEXT NOT NULL,
  payload          JSONB NOT NULL DEFAULT '{}'::jsonb,
  channels         TEXT[] NOT NULL,
  status           TEXT NOT NULL DEFAULT 'queued',
  idempotency_key  TEXT NOT NULL,
  locked_until     TIMESTAMPTZ,
  attempts         INTEGER NOT NULL DEFAULT 0,
  max_attempts     INTEGER NOT NULL DEFAULT 5,
  last_error       TEXT,
  provider_ref     TEXT,
  scheduled_for    TIMESTAMPTZ,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT chk_ob_status CHECK (status IN ('queued', 'scheduled', 'sending', 'delivered', 'failed', 'cancelled'))
);

-- Unique idempotency key: guarantees at-most-once logical delivery even with
-- worker retries or duplicate outbox inserts (ON CONFLICT DO NOTHING).
CREATE UNIQUE INDEX IF NOT EXISTS uq_notification_outbox_idempotency
  ON notification_outbox (idempotency_key);

-- Efficient lease claiming: only unlocked or expired-lease rows are picked.
CREATE INDEX IF NOT EXISTS idx_ob_dispatch
  ON notification_outbox (status, locked_until)
  WHERE status IN ('queued', 'scheduled', 'sending');
CREATE INDEX IF NOT EXISTS idx_ob_profile ON notification_outbox (profile_id);
CREATE INDEX IF NOT EXISTS idx_ob_created ON notification_outbox (created_at DESC);

-- ---------------------------------------------------------------------------
-- Create notification_job table
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS notification_job (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v7(),
  outbox_id    UUID NOT NULL REFERENCES notification_outbox(id) ON DELETE CASCADE,
  channel      TEXT NOT NULL,
  status       TEXT NOT NULL DEFAULT 'queued',
  priority     TEXT NOT NULL DEFAULT 'normal',
  attempts     INTEGER NOT NULL DEFAULT 0,
  max_attempts INTEGER NOT NULL DEFAULT 5,
  run_after    TIMESTAMPTZ,
  last_error   TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT chk_job_channel CHECK (channel IN ('in_app', 'email', 'sms')),
  CONSTRAINT chk_job_status CHECK (status IN ('queued', 'running', 'retrying', 'done', 'failed', 'dead_letter')),
  CONSTRAINT chk_job_priority CHECK (priority IN ('urgent', 'normal'))
);

-- At most one job per (outbox, channel).
CREATE UNIQUE INDEX IF NOT EXISTS uq_notification_job_outbox_channel
  ON notification_job (outbox_id, channel);

-- Claim order: urgent first, then longest-waiting. Partial on claimable rows.
CREATE INDEX IF NOT EXISTS idx_nj_dispatch
  ON notification_job (priority, created_at)
  WHERE status IN ('queued', 'retrying');
CREATE INDEX IF NOT EXISTS idx_nj_status_run
  ON notification_job (status, run_after)
  WHERE status IN ('queued', 'retrying');
CREATE INDEX IF NOT EXISTS idx_nj_outbox ON notification_job (outbox_id);

-- ---------------------------------------------------------------------------
-- updated_at triggers (mirror other domain tables)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION update_notification_outbox_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_ob_updated_at ON notification_outbox;
CREATE TRIGGER trg_ob_updated_at
  BEFORE UPDATE ON notification_outbox
  FOR EACH ROW EXECUTE FUNCTION update_notification_outbox_updated_at();

CREATE OR REPLACE FUNCTION update_notification_job_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_nj_updated_at ON notification_job;
CREATE TRIGGER trg_nj_updated_at
  BEFORE UPDATE ON notification_job
  FOR EACH ROW EXECUTE FUNCTION update_notification_job_updated_at();