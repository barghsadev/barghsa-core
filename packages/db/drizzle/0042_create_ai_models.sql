-- Migration 0042: AI model records for admin AI orchestration (T-09.11.01)
--
-- Creates the `ai_models` table — the durable record behind the admin AI
-- model management surface (S-09.11). One row per configured LLM endpoint:
--
-- Row layout:
--   id               UUID PK (uuidv7)
--   title            human-friendly display label (e.g. 'OpenAI GPT-4o')
--   provider_type    'openai_compatible' | 'anthropic'  (wire-protocol family)
--   base_url         API base URL supplied by the admin (e.g.
--                    https://api.openai.com/v1) — the test/ping path is
--                    derived from it; SSRF-guarded by the tester service.
--   model_name       model identifier sent to the provider (e.g. 'gpt-4o')
--   api_token        provider API token, encrypted at rest (AES-256-GCM,
--                    `AI_MODEL_ENCRYPTION_KEY`, v1: format). Nullable so
--                    token-less local endpoints (e.g. Ollama behind the
--                    deployment allow-list) can be configured; the tester
--                    fails with a clear error when a ping needs a token.
--   created_by       FK users.user_id (admin who created it)
--   last_tested_at   when the most recent connection test ran
--   last_test_status 'pending' | 'passed' | 'failed', default 'pending'
--   last_test_error  safe (non-secret) error from the latest failed test
--   created_at / updated_at
--
-- Guarantees:
--   - provider_type restricted via CHECK constraint.
--   - last_test_status restricted via CHECK constraint.
--   - Non-empty title / base_url / model_name enforced via CHECK.
--   - updated_at auto-maintained by trigger (mirrors email/sms provider rows).
--
-- Future dependents (T-09.11.04 AI agents) reference `id` via FK; the
-- ai_agents table lands in its own migration, so no FK is declared here yet.
--
-- Rollback:
--   DROP TABLE IF EXISTS ai_models;

CREATE TABLE IF NOT EXISTS ai_models (
  id               UUID PRIMARY KEY DEFAULT uuid_generate_v7(),
  title            TEXT NOT NULL,
  provider_type    TEXT NOT NULL,
  base_url         TEXT NOT NULL,
  model_name       TEXT NOT NULL,
  api_token        TEXT,
  created_by       TEXT NOT NULL REFERENCES users(user_id) ON DELETE RESTRICT,
  last_tested_at   TIMESTAMPTZ,
  last_test_status TEXT NOT NULL DEFAULT 'pending',
  last_test_error  TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Wire-protocol families understood by the tester service (T-09.11.01).
ALTER TABLE ai_models
  ADD CONSTRAINT chk_aim_provider_type
  CHECK (provider_type IN ('openai_compatible', 'anthropic'));

-- Test-outcome values (mirrors email/sms provider test status).
ALTER TABLE ai_models
  ADD CONSTRAINT chk_aim_last_test_status
  CHECK (last_test_status IN ('pending', 'passed', 'failed'));

-- Structural integrity: a model record without a label/URL/model name is
-- unusable by the tester and by future AI agents.
ALTER TABLE ai_models
  ADD CONSTRAINT chk_aim_non_empty_fields
  CHECK (title <> '' AND base_url <> '' AND model_name <> '');

-- List by recency for the admin UI.
CREATE INDEX IF NOT EXISTS idx_aim_created_at
  ON ai_models (created_at DESC);

-- ---------------------------------------------------------------------------
-- Trigger: auto-update updated_at on row modification
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION update_ai_models_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_aim_updated_at ON ai_models;
CREATE TRIGGER trg_aim_updated_at
  BEFORE UPDATE ON ai_models
  FOR EACH ROW
  EXECUTE FUNCTION update_ai_models_updated_at();
