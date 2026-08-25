-- Migration 0008: Create tos_acceptances table (T-04.01.02)
--
-- Records each TOS acceptance — both the initial registration acceptance
-- and any subsequent re-acceptance — as an immutable legal record.
-- Each entry captures which version was accepted, which user accepted it,
-- when, the source IP address, and the User-Agent header.
--
-- Rows are append-only — no updates, no deletes. Acceptance is legally
-- significant and must be preserved unchanged for audit purposes.
-- The user_id index enables efficient audit lookups.
--
-- Rollback:
--   DROP INDEX IF EXISTS idx_tos_acceptances_user_id;
--   DROP TABLE IF EXISTS tos_acceptances;

CREATE TABLE IF NOT EXISTS tos_acceptances (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v7(),
  user_id TEXT NOT NULL REFERENCES users(user_id) ON DELETE RESTRICT,
  version_id TEXT NOT NULL REFERENCES tos_versions(id) ON DELETE RESTRICT,
  accepted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ip_address TEXT,
  user_agent TEXT
);

CREATE INDEX IF NOT EXISTS idx_tos_acceptances_user_id ON tos_acceptances(user_id);