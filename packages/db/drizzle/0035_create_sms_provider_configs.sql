-- Migration 0035: SMS.ir provider configuration entity & lifecycle (T-09.06.02)
--
-- Creates the `sms_provider_configs` table — the durable record behind the SMS
-- provider administration lifecycle (Draft -> Test -> Active -> Superseded /
-- Disabled), mirroring the email provider config pattern (migration 0031).
--
-- Row layout:
--   id                UUID PK (uuidv7)
--   label             human-friendly display label
--   status            'draft' | 'active' | 'superseded' | 'disabled', default 'draft'
--   config            JSONB transport-specific config (encrypted at rest;
--                     secret field: `api_key`). SMS.ir fields:
--                       api_key            SMS.ir API key (encrypted)
--                       sender             sender/line number (application line)
--                       timeout            request timeout seconds
--                       throughput_limit   max outbound messages per minute
--                       low_credit_threshold  message balance alert threshold
--                       template_mappings  array of {eventKey -> smsir TemplateId
--                                            + variable mapping}. Base URL is
--                                            application-managed, NOT admin-editable.
--   created_by        FK users.userId (admin who created it)
--   activated_at      when promoted to active
--   activated_by      admin who activated it
--   last_test_at      when the latest test-send ran
--   last_test_status 'pending' | 'passed' | 'failed', default 'pending'
--   last_test_error  safe (non-secret) error from the latest failed test
--   supersedes_id    FK self — the active config this one replaced (rollback)
--   created_at / updated_at
--
-- Guarantees:
--   - At most one ACTIVE provider ever exists (partial unique index over the
--     active status). One active SMS provider per env.
--   - Provider status restricted via CHECK; test status restricted via CHECK.
--
-- Rollback:
--   DROP TABLE IF EXISTS sms_provider_configs;

CREATE TABLE IF NOT EXISTS sms_provider_configs (
  id               UUID PRIMARY KEY DEFAULT uuid_generate_v7(),
  transport        TEXT NOT NULL DEFAULT 'smsir',
  label            TEXT NOT NULL,
  status           TEXT NOT NULL DEFAULT 'draft',
  config           JSONB NOT NULL,
  created_by       TEXT NOT NULL REFERENCES users(user_id) ON DELETE RESTRICT,
  activated_at     TIMESTAMPTZ,
  activated_by     TEXT REFERENCES users(user_id) ON DELETE SET NULL,
  last_test_at     TIMESTAMPTZ,
  last_test_status TEXT NOT NULL DEFAULT 'pending',
  last_test_error  TEXT,
  supersedes_id    UUID REFERENCES sms_provider_configs(id) ON DELETE SET NULL,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Transport is the SMS provider backend (currently SMS.ir only).
ALTER TABLE sms_provider_configs
  ADD CONSTRAINT chk_spc_transport
  CHECK (transport IN ('smsir'));

-- Status machine values (T-09.06.02, mirrors email provider lifecycle).
ALTER TABLE sms_provider_configs
  ADD CONSTRAINT chk_spc_status
  CHECK (status IN ('draft', 'active', 'superseded', 'disabled'));

-- Marginal test-status values.
ALTER TABLE sms_provider_configs
  ADD CONSTRAINT chk_spc_last_test_status
  CHECK (last_test_status IN ('pending', 'passed', 'failed'));

-- At most one ACTIVE SMS provider configuration per environment. Partial unique
-- index rather than a unique (status) index so drafts/disabled/superseded rows
-- are NOT constrained (many drafts are expected).
CREATE UNIQUE INDEX IF NOT EXISTS uq_sms_provider_active
  ON sms_provider_configs (status)
  WHERE (status = 'active');

-- Rolling back to a superseded version is a common admin action; index it.
CREATE INDEX IF NOT EXISTS idx_spc_supersedes_id
  ON sms_provider_configs (supersedes_id);

-- List by recency for the admin UI.
CREATE INDEX IF NOT EXISTS idx_spc_created_at
  ON sms_provider_configs (created_at DESC);

-- ---------------------------------------------------------------------------
-- Trigger: auto-update updated_at on row modification
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION update_sms_provider_configs_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_spc_updated_at ON sms_provider_configs;
CREATE TRIGGER trg_spc_updated_at
  BEFORE UPDATE ON sms_provider_configs
  FOR EACH ROW
  EXECUTE FUNCTION update_sms_provider_configs_updated_at();
