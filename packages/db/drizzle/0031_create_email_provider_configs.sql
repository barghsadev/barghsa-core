-- Migration 0031: Email provider configuration entity & lifecycle (T-05.06.01)
--
-- Creates the `email_provider_configs` table — the durable record behind the
-- provider administration lifecycle (Draft -> Test-pass -> Active -> Superseded /
-- Disabled) described in T-05.06.01.
--
-- Row layout:
--   id               UUID PK (uuidv7)
--   transport        'smtp' | 'resend'  (immutable after creation)
--   label            human-friendly display label
--   status           'draft' | 'active' | 'superseded' | 'disabled', default 'draft'
--   config           JSONB transport-specific config (encrypted at rest, T-05.06.05)
--   created_by       FK users.userId (admin who created it)
--   activated_at     when promoted to active
--   last_test_at     when the latest test-send ran
--   last_test_status 'pending' | 'passed' | 'failed', default 'pending'
--   last_test_error  safe (non-secret) error from the latest failed test
--   supersedes_id    FK self — the active config this one replaced (rollback)
--   created_at / updated_at
--
-- Guarantees:
--   - At most one ACTIVE provider ever exists (partial unique index over the
--     active status). This enforces "one active provider per channel per env".
--   - Transport restricted via CHECK constraint; status restricted via CHECK.
--
-- Rollback:
--   DROP TABLE IF EXISTS email_provider_configs;

CREATE TABLE IF NOT EXISTS email_provider_configs (
  id               UUID PRIMARY KEY DEFAULT uuid_generate_v7(),
  transport        TEXT NOT NULL,
  label            TEXT NOT NULL,
  status           TEXT NOT NULL DEFAULT 'draft',
  config           JSONB NOT NULL,
  created_by       TEXT NOT NULL REFERENCES users(user_id) ON DELETE RESTRICT,
  activated_at     TIMESTAMPTZ,
  last_test_at     TIMESTAMPTZ,
  last_test_status TEXT NOT NULL DEFAULT 'pending',
  last_test_error  TEXT,
  supersedes_id    UUID REFERENCES email_provider_configs(id) ON DELETE SET NULL,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Transport is one of the two supported backends.
ALTER TABLE email_provider_configs
  ADD CONSTRAINT chk_epc_transport
  CHECK (transport IN ('smtp', 'resend'));

-- Status machine values (T-05.06.01).
ALTER TABLE email_provider_configs
  ADD CONSTRAINT chk_epc_status
  CHECK (status IN ('draft', 'active', 'superseded', 'disabled'));

-- Marginal test-status values.
ALTER TABLE email_provider_configs
  ADD CONSTRAINT chk_epc_last_test_status
  CHECK (last_test_status IN ('pending', 'passed', 'failed'));

-- At most one ACTIVE provider configuration per environment. Partial unique
-- index rather than a unique (status) btree index so drafts/disabled/superseded
-- rows are NOT constrained (many drafts are expected).
CREATE UNIQUE INDEX IF NOT EXISTS uq_email_provider_active
  ON email_provider_configs (status)
  WHERE (status = 'active');

-- Rolling back to a superseded version is a common admin action; index it.
CREATE INDEX IF NOT EXISTS idx_epc_supersedes_id
  ON email_provider_configs (supersedes_id);

-- List by recency for the admin UI.
CREATE INDEX IF NOT EXISTS idx_epc_created_at
  ON email_provider_configs (created_at DESC);

-- ---------------------------------------------------------------------------
-- Trigger: auto-update updated_at on row modification
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION update_email_provider_configs_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_epc_updated_at ON email_provider_configs;
CREATE TRIGGER trg_epc_updated_at
  BEFORE UPDATE ON email_provider_configs
  FOR EACH ROW
  EXECUTE FUNCTION update_email_provider_configs_updated_at();