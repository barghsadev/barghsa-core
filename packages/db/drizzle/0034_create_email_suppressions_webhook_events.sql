-- Email delivery callback handling (E-05, T-05.06.07).
--
-- Two tables back the Resend webhook receiver:
--   * email_webhook_events  — durable, idempotent ledger of every verified
--     Resend delivery/click/bounce/complaint event. `event_token` (the
--     `svix-id` header) is UNIQUE so re-delivered or replayed payloads are
--     ignored exactly once. `raw` keeps the verified snapshot for audit.
--   * email_suppressions   — addresses that must not receive non-essential
--     email, fed by hard bounces and spam complaints. UNIQUE (address, reason)
--     keeps suppression idempotent independently of the event ledger.
--
-- Both are created in this migration so the webhook handler can rely on them
-- immediately after `pnpm db:migrate:run`.

CREATE TABLE IF NOT EXISTS email_webhook_events (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v7(),
  event_token   TEXT NOT NULL,
  event_type    TEXT NOT NULL,
  message_id    TEXT,
  to_address    TEXT,
  from_address  TEXT,
  outbox_id     UUID REFERENCES notification_outbox(id) ON DELETE SET NULL,
  status        TEXT CHECK (status IN ('delivered','failed','opened','clicked','complained')),
  raw           JSONB,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_email_webhook_event_token ON email_webhook_events (event_token);
CREATE INDEX IF NOT EXISTS idx_ewe_message ON email_webhook_events (message_id);
CREATE INDEX IF NOT EXISTS idx_ewe_address ON email_webhook_events (to_address);

CREATE TABLE IF NOT EXISTS email_suppressions (
  id               UUID PRIMARY KEY DEFAULT uuid_generate_v7(),
  address          TEXT NOT NULL,
  reason           TEXT NOT NULL CHECK (reason IN ('hard_bounce','complaint')),
  profile_id       UUID REFERENCES profiles(id) ON DELETE CASCADE,
  source_event_id  UUID REFERENCES email_webhook_events(id) ON DELETE SET NULL,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_email_suppression ON email_suppressions (address, reason);
CREATE INDEX IF NOT EXISTS idx_email_suppression_address ON email_suppressions (address);