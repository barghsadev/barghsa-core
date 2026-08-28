-- Migration 0043: Knowledge bases & KB groups for admin AI orchestration (T-09.11.02)
--
-- Creates the durable records behind the admin knowledge base management
-- surface (S-09.11). Four tables:
--
--   knowledge_bases    one row per KB: title, description, owner
--   kb_documents       documents attached to a KB. A document is a file in
--                      the shared document system (storage_records, S3 +
--                      presigned upload); the link row snapshots the file
--                      metadata and tracks the chunk/embed processing state
--                      for AI retrieval. The actual chunking/embedding worker
--                      pipeline is supplied by the document-processing epic
--                      (E-05 tasks T-05.09/T-05.11+); this migration fixes the
--                      contract (status values + columns) so the worker can
--                      claim rows without a schema change.
--   kb_groups          one row per KB group: title, description, owner
--   kb_group_members   many-to-many link KBs to groups (a KB can belong to
--                      several groups; a group collects several KBs)
--
-- Row layout (knowledge_bases):
--   id          UUID PK (uuidv7)
--   title       human-friendly label, non-empty
--   description free-text notes
--   created_by  FK users.user_id (admin who created it)
--   created_at / updated_at
--
-- Guarantees:
--   - Non-empty titles via CHECK constraints.
--   - kb_documents.processing_status restricted via CHECK
--     ('pending' | 'processing' | 'ready' | 'failed').
--   - A document can be attached to a KB at most once
--     (UNIQUE (kb_id, storage_key)).
--   - Deleting a KB cascades to its document links and group memberships;
--     the underlying storage records are untouched (shared document store).
--   - updated_at auto-maintained by triggers (mirrors ai_models).
--
-- Rollback:
--   DROP TABLE IF EXISTS kb_group_members, kb_groups, kb_documents, knowledge_bases;

CREATE TABLE IF NOT EXISTS knowledge_bases (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v7(),
  title       TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  created_by  TEXT NOT NULL REFERENCES users(user_id) ON DELETE RESTRICT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS kb_documents (
  id                UUID PRIMARY KEY DEFAULT uuid_generate_v7(),
  kb_id             UUID NOT NULL REFERENCES knowledge_bases(id) ON DELETE CASCADE,
  storage_key       TEXT NOT NULL REFERENCES storage_records(storage_key) ON DELETE RESTRICT,
  file_name         TEXT NOT NULL,
  mime_type         TEXT,
  size_bytes        BIGINT,
  processing_status TEXT NOT NULL DEFAULT 'pending',
  processing_error  TEXT,
  created_by        TEXT NOT NULL REFERENCES users(user_id) ON DELETE RESTRICT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS kb_groups (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v7(),
  title       TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  created_by  TEXT NOT NULL REFERENCES users(user_id) ON DELETE RESTRICT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS kb_group_members (
  group_id   UUID NOT NULL REFERENCES kb_groups(id) ON DELETE CASCADE,
  kb_id      UUID NOT NULL REFERENCES knowledge_bases(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (group_id, kb_id)
);

-- A KB without a label is unusable by agents (T-09.11.04).
ALTER TABLE knowledge_bases
  ADD CONSTRAINT chk_kb_title
  CHECK (title <> '');

-- Same for groups.
ALTER TABLE kb_groups
  ADD CONSTRAINT chk_kbg_title
  CHECK (title <> '');

-- Chunk/embed pipeline states consumed by the future worker (E-05).
ALTER TABLE kb_documents
  ADD CONSTRAINT chk_kbd_processing_status
  CHECK (processing_status IN ('pending', 'processing', 'ready', 'failed'));

-- A document is attached to a KB exactly once.
ALTER TABLE kb_documents
  ADD CONSTRAINT uq_kbd_kb_storage
  UNIQUE (kb_id, storage_key);

-- List by recency for the admin UI.
CREATE INDEX IF NOT EXISTS idx_kb_created_at
  ON knowledge_bases (created_at DESC);

-- Documents of one KB (admin detail view).
CREATE INDEX IF NOT EXISTS idx_kbd_kb_id
  ON kb_documents (kb_id);

-- Pending-document claim queries for the future chunk/embed worker.
CREATE INDEX IF NOT EXISTS idx_kbd_processing_status
  ON kb_documents (processing_status)
  WHERE processing_status IN ('pending', 'processing', 'failed');

-- Groups list by recency.
CREATE INDEX IF NOT EXISTS idx_kbg_created_at
  ON kb_groups (created_at DESC);

-- Reverse lookup: which groups contain a given KB.
CREATE INDEX IF NOT EXISTS idx_kbgm_kb_id
  ON kb_group_members (kb_id);

-- ---------------------------------------------------------------------------
-- Triggers: auto-update updated_at on row modification
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION update_knowledge_bases_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_kb_updated_at ON knowledge_bases;
CREATE TRIGGER trg_kb_updated_at
  BEFORE UPDATE ON knowledge_bases
  FOR EACH ROW
  EXECUTE FUNCTION update_knowledge_bases_updated_at();

DROP TRIGGER IF EXISTS trg_kbd_updated_at ON kb_documents;
CREATE TRIGGER trg_kbd_updated_at
  BEFORE UPDATE ON kb_documents
  FOR EACH ROW
  EXECUTE FUNCTION update_knowledge_bases_updated_at();

DROP TRIGGER IF EXISTS trg_kbg_updated_at ON kb_groups;
CREATE TRIGGER trg_kbg_updated_at
  BEFORE UPDATE ON kb_groups
  FOR EACH ROW
  EXECUTE FUNCTION update_knowledge_bases_updated_at();