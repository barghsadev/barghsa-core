-- Migration 0049: Contract templates (T-09.12.04)
--
-- Admin-managed contract document templates with placeholders. Templates
-- are versioned; every version stores its file in object storage and the
-- placeholders extracted at upload time.
--
-- contract_templates:
--   id          UUIDv7 PK
--   name        TEXT — display name, trimmed, case-insensitively UNIQUE
--               (index on LOWER(name))
--   description TEXT — nullable metadata
--   status      TEXT — 'active' | 'inactive' (default active). Inactive
--               = archived; templates with history cannot be hard-deleted,
--               deactivation is the archival path.
--   created_by  TEXT FK users.user_id ON DELETE RESTRICT
--   created_at / updated_at (base columns)
--
-- contract_template_versions — append-only version history:
--   id            UUIDv7 PK
--   template_id   UUID FK contract_templates.id ON DELETE RESTRICT
--                 (a template with versions can never be hard-deleted —
--                 versions are the audit archive)
--   version_number INTEGER — 1-based per-template sequence, UNIQUE per
--                 template. A new version keeps all previous files as
--                 the archive of prior versions.
--   storage_key   TEXT — object-storage key for the template file
--   file_name     TEXT — original upload file name
--   content_type  TEXT — MIME as provided (sanitized)
--   file_size     BIGINT — bytes
--   placeholders  TEXT[] — extracted from the file at upload time via
--                 regex ({{name}}); never edited after upload
--   created_by    TEXT FK users.user_id ON DELETE RESTRICT
--   created_at    (base column)
--
-- contract_type_templates — no-delete seam for S-04.5.03 (contract types
-- & activation rules):
--   contract_type_id UUID — FK to contract_types(id) is added when that
--                 module lands (S-04.5.03); no FK today because the table
--                 does not exist yet.
--   template_id   UUID FK contract_templates.id ON DELETE RESTRICT
--   PK (contract_type_id, template_id)
--
--   Rows are written by the contract-types module when a contract type
--   references a template. The RESTRICT FK is the hard guarantee behind
--   "cannot delete a template referenced by (active) contract types":
--   once a link row exists, DELETE on contract_templates fails at the DB
--   level; the service maps it to a 409 with a friendly message.
--
-- Rollback:
--   DROP TABLE IF EXISTS contract_type_templates CASCADE;
--   DROP TABLE IF EXISTS contract_template_versions CASCADE;
--   DROP TABLE IF EXISTS contract_templates CASCADE;

-- ---------------------------------------------------------------------------
-- contract_templates
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS contract_templates (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v7(),
  name TEXT NOT NULL,
  description TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  created_by TEXT NOT NULL REFERENCES users(user_id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE contract_templates
  ADD CONSTRAINT chk_contract_templates_status
  CHECK (status IN ('active', 'inactive'));

ALTER TABLE contract_templates
  ADD CONSTRAINT chk_contract_templates_name
  CHECK (length(btrim(name)) > 0);

-- Case-insensitive uniqueness (service stores the trimmed name as given).
CREATE UNIQUE INDEX IF NOT EXISTS uq_contract_templates_name_lower
  ON contract_templates (LOWER(name));
CREATE INDEX IF NOT EXISTS idx_contract_templates_status
  ON contract_templates (status);

-- ---------------------------------------------------------------------------
-- contract_template_versions
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS contract_template_versions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v7(),
  template_id UUID NOT NULL REFERENCES contract_templates(id) ON DELETE RESTRICT,
  version_number INTEGER NOT NULL,
  storage_key TEXT NOT NULL,
  file_name TEXT NOT NULL,
  content_type TEXT,
  file_size BIGINT,
  placeholders TEXT[] NOT NULL DEFAULT '{}',
  created_by TEXT NOT NULL REFERENCES users(user_id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE contract_template_versions
  ADD CONSTRAINT chk_contract_template_versions_version_number
  CHECK (version_number > 0);

-- Storage key is globally unique (files are never shared between versions).
CREATE UNIQUE INDEX IF NOT EXISTS uq_contract_template_versions_storage_key
  ON contract_template_versions (storage_key);
CREATE UNIQUE INDEX IF NOT EXISTS uq_contract_template_versions_template_ver
  ON contract_template_versions (template_id, version_number);
CREATE INDEX IF NOT EXISTS idx_contract_template_versions_template
  ON contract_template_versions (template_id);

-- ---------------------------------------------------------------------------
-- contract_type_templates (no-delete seam, S-04.5.03)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS contract_type_templates (
  contract_type_id UUID NOT NULL,
  template_id UUID NOT NULL REFERENCES contract_templates(id) ON DELETE RESTRICT,
  PRIMARY KEY (contract_type_id, template_id)
);

CREATE INDEX IF NOT EXISTS idx_contract_type_templates_template_id
  ON contract_type_templates (template_id);

-- ---------------------------------------------------------------------------
-- updated_at triggers
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION update_contract_templates_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_contract_templates_updated_at
  BEFORE UPDATE ON contract_templates
  FOR EACH ROW
  EXECUTE FUNCTION update_contract_templates_updated_at();