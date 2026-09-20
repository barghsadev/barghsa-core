-- Add group references without changing existing direct agent links.
CREATE TABLE IF NOT EXISTS ai_agent_kb_groups (
  agent_id uuid NOT NULL REFERENCES ai_agents(id) ON DELETE CASCADE,
  group_id uuid NOT NULL REFERENCES kb_groups(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ai_agent_kb_groups_agent_id_group_id_pk PRIMARY KEY (agent_id, group_id)
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_aiakg_group_id ON ai_agent_kb_groups(group_id);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS ai_agent_policy_groups (
  agent_id uuid NOT NULL REFERENCES ai_agents(id) ON DELETE CASCADE,
  group_id uuid NOT NULL REFERENCES ai_policy_groups(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ai_agent_policy_groups_agent_id_group_id_pk PRIMARY KEY (agent_id, group_id)
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_aiapg_group_id ON ai_agent_policy_groups(group_id);
