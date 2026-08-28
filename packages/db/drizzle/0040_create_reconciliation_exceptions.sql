-- Migration 0040: Reconciliation exception ledger (T-09.09.01)
--
-- The admin/staff surface of S-09.09 lets a staff user view and resolve
-- reconciliation exceptions (wallet mismatch, payment mismatch, …). The
-- finance reconciliation system (a later epic dependency) *produces* these
-- rows; this migration lays down the ledger the admin review surface reads
-- and the future reconciliation producer writes.
--
-- Row layout:
--   id            UUID PK (uuidv7, DB-generated via uuid_generate_v7())
--   exception_type 'wallet_mismatch' | 'payment_mismatch' — must stay in
--                  sync with RECONCILIATION_EXCEPTION_TYPES in
--                  packages/shared/src/admin/reconciliation-exceptions.ts
--   severity      'low' | 'medium' | 'high' | 'critical' (default 'medium')
--   status        'open' | 'investigating' | 'resolved' | 'closed'
--                  (default 'open')
--   description   human-readable summary of the mismatch
--   details       optional JSONB full reconciliation payload (audit copy)
--   assigned_to_id   FK users (staff member working it); SET NULL on delete
--   resolved_by_id   FK users (who resolved/closed it); SET NULL on delete
--   resolution_note  explainer recorded on resolve/close
--   resolved_at      when the item left open/investigating
--   created_at / updated_at  base columns (createTable contract)
--
-- All constraints are declared inline in CREATE TABLE so the migration is
-- safely re-appliable (no separate ALTER TABLE steps that would abort with
-- duplicate-constraint errors on a re-run). The composite index doubles as
-- the admin list view's default ordering path (status first, newest first).
--
-- Rollback:
--   DROP TABLE IF EXISTS reconciliation_exceptions;

CREATE TABLE IF NOT EXISTS reconciliation_exceptions (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v7(),
  exception_type TEXT NOT NULL,
  severity       TEXT NOT NULL DEFAULT 'medium',
  status         TEXT NOT NULL DEFAULT 'open',
  description    TEXT NOT NULL,
  details        JSONB NOT NULL DEFAULT '{}'::jsonb,
  assigned_to_id UUID,
  resolved_by_id UUID,
  resolution_note TEXT,
  resolved_at    TIMESTAMPTZ,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT chk_rex_type
    CHECK (exception_type IN ('wallet_mismatch', 'payment_mismatch')),
  CONSTRAINT chk_rex_severity
    CHECK (severity IN ('low', 'medium', 'high', 'critical')),
  CONSTRAINT chk_rex_status
    CHECK (status IN ('open', 'investigating', 'resolved', 'closed')),

  CONSTRAINT fk_rex_assigned_to
    FOREIGN KEY (assigned_to_id) REFERENCES users(user_id) ON DELETE SET NULL,
  CONSTRAINT fk_rex_resolved_by
    FOREIGN KEY (resolved_by_id) REFERENCES users(user_id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_reconciliation_exceptions_status_created_at
  ON reconciliation_exceptions (status, created_at DESC);