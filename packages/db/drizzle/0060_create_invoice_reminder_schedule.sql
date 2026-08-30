-- Migration 0060: invoice_reminder_schedule (T-04.1.04.01)
--
-- Per-invoice payment reminder plan (S-04.1.04). One row is one planned
-- reminder for a single invoice, offset, and channel.
--
-- invoice_reminder_schedule:
--   id            UUIDv7 PK
--   invoice_id    UUID FK invoices.id ON DELETE CASCADE
--   "offset"      INTEGER — days relative to invoices.due_at; CHECK the
--                   canonical set -7, -3, -1, 0, +1, +7 (quoted: OFFSET
--                   is a reserved word)
--   channel       TEXT — in_app | email | sms
--   scheduled_at  TIMESTAMPTZ — when the row becomes eligible
--   sent_at       TIMESTAMPTZ — set iff status = 'sent'
--   status        TEXT — scheduled | sent | cancelled (default scheduled)
--   created_at / updated_at (base columns)
--
-- Guarantees:
--   - offset is one of the S-04.1.04 default offsets;
--   - channel is a notification transport;
--   - status is one of the three lifecycle values;
--   - sent_at is NOT NULL exactly when status is 'sent';
--   - lookup index on invoice_id (cancel remaining rows, T-04.1.04.06);
--   - partial index on scheduled_at WHERE status = 'scheduled' (sender);
--   - updated_at maintained by trigger.
--
-- The unique index on (invoice_id, offset, channel) is T-04.1.04.04 and
-- is intentionally not created here.
--
-- Rollback:
--   DROP TABLE IF EXISTS invoice_reminder_schedule CASCADE;
--   DROP FUNCTION IF EXISTS update_invoice_reminder_schedule_updated_at();

CREATE TABLE IF NOT EXISTS invoice_reminder_schedule (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v7(),
  invoice_id UUID NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
  "offset" INTEGER NOT NULL
    CONSTRAINT chk_invoice_reminder_schedule_offset
      CHECK ("offset" IN (-7, -3, -1, 0, 1, 7)),
  channel TEXT NOT NULL
    CONSTRAINT chk_invoice_reminder_schedule_channel
      CHECK (channel IN ('in_app', 'email', 'sms')),
  scheduled_at TIMESTAMPTZ NOT NULL,
  sent_at TIMESTAMPTZ,
  status TEXT NOT NULL DEFAULT 'scheduled'
    CONSTRAINT chk_invoice_reminder_schedule_status
      CHECK (status IN ('scheduled', 'sent', 'cancelled')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT chk_invoice_reminder_schedule_sent_at
    CHECK (
      (status = 'sent' AND sent_at IS NOT NULL)
      OR (status <> 'sent' AND sent_at IS NULL)
    )
);

CREATE INDEX IF NOT EXISTS idx_invoice_reminder_schedule_invoice_id
  ON invoice_reminder_schedule (invoice_id);
CREATE INDEX IF NOT EXISTS idx_invoice_reminder_schedule_due
  ON invoice_reminder_schedule (scheduled_at)
  WHERE status = 'scheduled';

CREATE OR REPLACE FUNCTION update_invoice_reminder_schedule_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_invoice_reminder_schedule_updated_at
  ON invoice_reminder_schedule;

CREATE TRIGGER trg_invoice_reminder_schedule_updated_at
  BEFORE UPDATE ON invoice_reminder_schedule
  FOR EACH ROW
  EXECUTE FUNCTION update_invoice_reminder_schedule_updated_at();
