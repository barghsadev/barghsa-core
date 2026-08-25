-- Migration 0005: Create audit_log table (T-02.03.02)
--
-- Records security-sensitive events (password reset, login, etc.) for
-- audit trail compliance. Append-only — entries are never updated or deleted.
--
-- Rollback:
--   DROP TABLE IF EXISTS audit_log;
--   DROP INDEX IF EXISTS idx_audit_log_user_id;
--   DROP INDEX IF EXISTS idx_audit_log_event;
--   DROP INDEX IF EXISTS idx_audit_log_created_at;

CREATE TABLE IF NOT EXISTS audit_log (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(user_id) ON DELETE RESTRICT,
  event TEXT NOT NULL,
  metadata TEXT,
  correlation_id TEXT,
  ip TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_audit_log_user_id ON audit_log(user_id);
CREATE INDEX IF NOT EXISTS idx_audit_log_event ON audit_log(event);
CREATE INDEX IF NOT EXISTS idx_audit_log_created_at ON audit_log(created_at);