-- Migration 0044: AI usage policies & policy groups (T-09.11.03)
--
-- Durable records behind the admin AI policy management surface (S-09.11).
-- Policies define the rules, permissions, and guardrails that AI agents
-- (T-09.11.04) must obey. Three tables:
--
--   ai_policies            one row per policy: title, type, rules, enabled
--   ai_policy_groups       named collections of policies
--   ai_policy_group_members many-to-many link policies to groups
--
-- Policy types (fixed set mirrored by the API):
--   allowed_topics     topics the agent may respond about
--   disallowed_actions actions the agent must never perform
--   data_access_scope  which data domains the agent may read
--   response_style     tone / language / length guardrails
--
-- `rules` is a JSONB document whose shape depends on `policy_type`; the API
-- validates it (structured editor) before persisting. `enabled` lets an
-- admin deactivate a policy without deleting it.
--
-- Row layout (ai_policies):
--   id          UUID PK (uuidv7)
--   title       human-friendly label, non-empty
--   description free-text notes
--   policy_type one of the types above (CHECK)
--   rules       JSONB guardrail document
--   enabled     active/inactive flag for assignment
--   created_by  FK users.user_id (admin who created it)
--   created_at / updated_at
--
-- Guarantees:
--   - Non-empty titles via CHECK constraints.
--   - policy_type restricted via CHECK to the supported set.
--   - A policy belongs to a group exactly once (composite PK on members).
--   - Deleting a policy or group cascades to memberships.
--   - updated_at auto-maintained by triggers (mirrors ai_models / KB).
--
-- Rollback:
--   DROP TABLE IF EXISTS ai_policy_group_members, ai_policy_groups, ai_policies;

CREATE TABLE IF NOT EXISTS ai_policies (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v7(),
  title       TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  policy_type TEXT NOT NULL,
  rules       JSONB NOT NULL DEFAULT '{}'::jsonb,
  enabled     BOOLEAN NOT NULL DEFAULT TRUE,
  created_by  TEXT NOT NULL REFERENCES users(user_id) ON DELETE RESTRICT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS ai_policy_groups (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v7(),
  title       TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  created_by  TEXT NOT NULL REFERENCES users(user_id) ON DELETE RESTRICT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS ai_policy_group_members (
  group_id   UUID NOT NULL REFERENCES ai_policy_groups(id) ON DELETE CASCADE,
  policy_id  UUID NOT NULL REFERENCES ai_policies(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (group_id, policy_id)
);

-- A policy without a label is unusable by agents (T-09.11.04).
ALTER TABLE ai_policies
  ADD CONSTRAINT chk_aip_title
  CHECK (title <> '');

-- Same for groups.
ALTER TABLE ai_policy_groups
  ADD CONSTRAINT chk_aipg_title
  CHECK (title <> '');

-- Only the supported policy kinds are storable.
ALTER TABLE ai_policies
  ADD CONSTRAINT chk_aip_type
  CHECK (policy_type IN ('allowed_topics', 'disallowed_actions', 'data_access_scope', 'response_style'));

-- List by recency for the admin UI.
CREATE INDEX IF NOT EXISTS idx_aip_created_at
  ON ai_policies (created_at DESC);

-- Filtering by guardrail kind (admin policy list type filter).
CREATE INDEX IF NOT EXISTS idx_aip_type
  ON ai_policies (policy_type);

-- Groups list by recency.
CREATE INDEX IF NOT EXISTS idx_aipg_created_at
  ON ai_policy_groups (created_at DESC);

-- Reverse lookup: which groups contain a given policy.
CREATE INDEX IF NOT EXISTS idx_aipgm_policy_id
  ON ai_policy_group_members (policy_id);

-- ---------------------------------------------------------------------------
-- Triggers: auto-update updated_at on row modification
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION update_ai_policies_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_aip_updated_at ON ai_policies;
CREATE TRIGGER trg_aip_updated_at
  BEFORE UPDATE ON ai_policies
  FOR EACH ROW
  EXECUTE FUNCTION update_ai_policies_updated_at();

DROP TRIGGER IF EXISTS trg_aipg_updated_at ON ai_policy_groups;
CREATE TRIGGER trg_aipg_updated_at
  BEFORE UPDATE ON ai_policy_groups
  FOR EACH ROW
  EXECUTE FUNCTION update_ai_policies_updated_at();