-- Migration 0062: invoice_reminder_offset_toggles (T-04.1.04.05)
--
-- Admin enable/disable flags for each S-04.1.04 reminder offset
-- (-7, -3, -1, 0, +1, +7) per invoice service type (electricity,
-- saving_plan, consultation, manual). Missing pairs default to enabled.
--
--   * UNIQUE (service_type, "offset") so admin upserts are deterministic.
--   * `"offset"` is quoted because OFFSET is a reserved word.
--   * updated_by references users (RESTRICT) for the last writer.
--
-- Idempotency: CREATE TABLE IF NOT EXISTS, CREATE INDEX IF NOT EXISTS,
-- DROP TRIGGER IF EXISTS.
--
-- Rollback:
--   DROP TRIGGER IF EXISTS trg_invoice_reminder_offset_toggles_updated_at
--     ON invoice_reminder_offset_toggles;
--   DROP FUNCTION IF EXISTS update_invoice_reminder_offset_toggles_updated_at();
--   DROP TABLE IF EXISTS invoice_reminder_offset_toggles;

CREATE TABLE IF NOT EXISTS invoice_reminder_offset_toggles (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v7(),
  service_type TEXT NOT NULL
    CONSTRAINT chk_invoice_reminder_offset_toggles_service_type
      CHECK (service_type IN ('electricity', 'saving_plan', 'consultation', 'manual')),
  "offset" INTEGER NOT NULL
    CONSTRAINT chk_invoice_reminder_offset_toggles_offset
      CHECK ("offset" IN (-7, -3, -1, 0, 1, 7)),
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  updated_by TEXT NOT NULL REFERENCES users(user_id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_invoice_reminder_offset_toggles_type_offset
    UNIQUE (service_type, "offset")
);

CREATE INDEX IF NOT EXISTS idx_invoice_reminder_offset_toggles_service_type
  ON invoice_reminder_offset_toggles (service_type);

CREATE OR REPLACE FUNCTION update_invoice_reminder_offset_toggles_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_invoice_reminder_offset_toggles_updated_at
  ON invoice_reminder_offset_toggles;

CREATE TRIGGER trg_invoice_reminder_offset_toggles_updated_at
  BEFORE UPDATE ON invoice_reminder_offset_toggles
  FOR EACH ROW
  EXECUTE FUNCTION update_invoice_reminder_offset_toggles_updated_at();
