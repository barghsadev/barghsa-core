-- Migration 0045: AI agents for admin AI orchestration (T-09.11.04)
--
-- Durable records behind the admin AI agent management surface (S-09.11).
-- An agent ties together the previously built admin AI primitives:
--
--   ai_agents          one row per agent: title, description, model ref,
--                     active/inactive flag
--   ai_agent_kbs       many-to-many link agent -> knowledge base
--   ai_agent_policies  many-to-many link agent -> AI usage policy
--
-- Each agent must reference exactly one AI model (ai_models, T-09.11.01).
-- Knowledge bases (T-09.11.02) and usage policies (T-09.11.03) are
-- optional references an agent uses to ground its answers and to enforce
-- guardrails. The technical contract from the epic is agent config =
-- model_id + kb_ids[] + policy_ids[]; the link rows persist those arrays.
--
-- Row layout (ai_agents):
--   id          UUID PK (uuidv7)
--   title       human-friendly label, non-empty
--   description free-text notes
--   model_id    FK ai_models.id — the LLM endpoint this agent talks to
--   enabled     active/inactive flag (controls slot assignment T-09.11.05)
--   created_by  FK users.user_id (admin who created it)
--   created_at / updated_at
--
-- Guarantees:
--   - Non-empty titles via a guarded CHECK constraint.
--   - A KB (or policy) is linked to an agent exactly once
--     (composite PK on each link table).
--   - Deleting an agent cascades to its links; deleting a KB or policy
--     cascades away the now-dangling link.
--   - Deleting a model referenced by an agent is RESTRICTed: the
--     ai_models delete path surfaces the 23503 violation as a 409
--     (AI_MODEL_IN_USE) so an agent never silently loses its brain.
--   - updated_at auto-maintained by triggers (mirrors ai_models / KB /
--     policies).
--
-- Rollback:
--   DROP TABLE IF EXISTS ai_agent_policies, ai_agent_kbs, ai_agents;

CREATE TABLE IF NOT EXISTS ai_agents (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v7(),
  title       TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  model_id    UUID NOT NULL REFERENCES ai_models(id) ON DELETE RESTRICT,
  enabled     BOOLEAN NOT NULL DEFAULT TRUE,
  created_by  TEXT NOT NULL REFERENCES users(user_id) ON DELETE RESTRICT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS ai_agent_kbs (
  agent_id   UUID NOT NULL REFERENCES ai_agents(id) ON DELETE CASCADE,
  kb_id      UUID NOT NULL REFERENCES knowledge_bases(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (agent_id, kb_id)
);

CREATE TABLE IF NOT EXISTS ai_agent_policies (
  agent_id   UUID NOT NULL REFERENCES ai_agents(id) ON DELETE CASCADE,
  policy_id  UUID NOT NULL REFERENCES ai_policies(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (agent_id, policy_id)
);

-- An agent without a label is unusable.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_aia_title') THEN
    ALTER TABLE ai_agents
      ADD CONSTRAINT chk_aia_title
      CHECK (title <> '');
  END IF;
END $$;

-- Admin list by recency.
CREATE INDEX IF NOT EXISTS idx_aia_created_at
  ON ai_agents (created_at DESC);

-- Admin agent list model filter (and referential checks).
CREATE INDEX IF NOT EXISTS idx_aia_model_id
  ON ai_agents (model_id);

-- KB links of one agent (detail view); PK leftmost prefix covers it, but
-- the explicit index keeps the intent readable and matches the sibling
-- reverse-lookup indexes.
CREATE INDEX IF NOT EXISTS idx_aiak_agent_id
  ON ai_agent_kbs (agent_id);

-- Policy links of one agent (detail view).
CREATE INDEX IF NOT EXISTS idx_aiap_agent_id
  ON ai_agent_policies (agent_id);

-- Reverse lookups for ON DELETE CASCADE: deleting a knowledge base or
-- policy must find its link rows without a sequential scan (the composite
-- PK only covers agent_id-leading lookups).
CREATE INDEX IF NOT EXISTS idx_aiak_kb_id
  ON ai_agent_kbs (kb_id);

CREATE INDEX IF NOT EXISTS idx_aiap_policy_id
  ON ai_agent_policies (policy_id);

-- ---------------------------------------------------------------------------
-- Triggers: auto-update updated_at on row modification
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION update_ai_agents_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_aia_updated_at ON ai_agents;
CREATE TRIGGER trg_aia_updated_at
  BEFORE UPDATE ON ai_agents
  FOR EACH ROW
  EXECUTE FUNCTION update_ai_agents_updated_at();
