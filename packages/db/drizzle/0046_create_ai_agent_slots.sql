-- Migration 0046: AI agent slot assignment (T-09.11.05)
--
-- Durable records behind the "agent slot assignment" admin surface
-- (S-09.11). Slots are FIXED system configuration: exactly five
-- predefined chatbot surfaces — Individual, Legal Entity, Staff,
-- Website, Telegram — that the admin points at an AI agent
-- (ai_agents, T-09.11.04). One agent can be used in several slots;
-- each slot holds at most one agent.
--
-- Row layout (ai_agent_slots):
--   slot_key   TEXT PK — stable identifier consumed by the frontend and
--              external integrations ("Slots are consumed by frontend and
--              external integrations" per the epic)
--   label      display label (English for now; the fa/en dictionaries and
--              the admin web UI land with the UI slice)
--   agent_id   FK ai_agents.id, SET NULL — deleting an agent simply
--              unassigns it from its slots instead of blocking deletes
--              or dangling references
--   updated_by FK users.user_id, SET NULL — last admin who changed it
--   updated_at auto-maintained by trigger
--
-- Guarantees:
--   - The five predefined slot keys are pinned by a CHECK constraint:
--     slots are system configuration, not free-form rows.
--   - The label CHECK mirrors the sibling admin AI tables (non-empty).
--   - Explicit assignment changes are audited at the API layer
--     (ai_agent_slot_assigned / ai_agent_slot_cleared); an agent
--     deletion that SET NULLs a slot is already recorded by the
--     ai_agent_deleted audit event.
--   - updated_at auto-maintained by trigger (mirrors ai_agents).
--
-- Rollback:
--   DROP TABLE IF EXISTS ai_agent_slots;

CREATE TABLE IF NOT EXISTS ai_agent_slots (
  slot_key   TEXT PRIMARY KEY,
  label      TEXT NOT NULL,
  agent_id   UUID REFERENCES ai_agents(id) ON DELETE SET NULL,
  updated_by TEXT REFERENCES users(user_id) ON DELETE SET NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Seed the five predefined chatbot slots.
INSERT INTO ai_agent_slots (slot_key, label) VALUES
  ('individual_chatbot',   'Individual chatbot'),
  ('legal_entity_chatbot', 'Legal Entity chatbot'),
  ('staff_chatbot',        'Staff chatbot'),
  ('website_chatbot',      'Website chatbot'),
  ('telegram_chatbot',     'Telegram chatbot')
ON CONFLICT (slot_key) DO NOTHING;

-- A slot without a label is unusable.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_aias_label') THEN
    ALTER TABLE ai_agent_slots
      ADD CONSTRAINT chk_aias_label
      CHECK (label <> '');
  END IF;
END $$;

-- Slots are the predefined system-configuration set; ad-hoc keys must not
-- sneak in (the API validates the same enum, this pins the storage layer).
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_aias_slot_key') THEN
    ALTER TABLE ai_agent_slots
      ADD CONSTRAINT chk_aias_slot_key
      CHECK (
        slot_key IN (
          'individual_chatbot',
          'legal_entity_chatbot',
          'staff_chatbot',
          'website_chatbot',
          'telegram_chatbot'
        )
      );
  END IF;
END $$;

-- Reverse lookup: which slots use an agent ("This agent is also used in
-- [other slots]" warning in the UI) and the SET NULL cascade delete path.
CREATE INDEX IF NOT EXISTS idx_aias_agent_id
  ON ai_agent_slots (agent_id);

-- ---------------------------------------------------------------------------
-- Trigger: auto-update updated_at on row modification
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION update_ai_agent_slots_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_aias_updated_at ON ai_agent_slots;
CREATE TRIGGER trg_aias_updated_at
  BEFORE UPDATE ON ai_agent_slots
  FOR EACH ROW
  EXECUTE FUNCTION update_ai_agent_slots_updated_at();
