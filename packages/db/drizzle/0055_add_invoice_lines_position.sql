-- Migration 0055: Add explicit line ordering column to invoice_lines (T-04.1.02.02)
--
-- Manual invoices carry N custom lines whose display order matters (the
-- order the finance staff enters them). Before this migration the only
-- ordering signal was created_at (same-timestamp ties possible), which
-- makes line order ambiguous. The review follow-up on PR #223 explicitly
-- requested an "explicit line ordering column for T-04.1.02.02".
--
--   * `position` — 0-based ordinal of the line within its invoice.
--     Defaults to 0 so existing rows (created before this migration) and
--     re-runs are safe; the ManualInvoiceService writes 0..N-1 on insert.
--
-- Idempotent: ADD COLUMN IF NOT EXISTS makes re-runs a no-op.
--
-- Rollback:
--   ALTER TABLE invoice_lines DROP COLUMN IF EXISTS position;

ALTER TABLE invoice_lines
  ADD COLUMN IF NOT EXISTS position INTEGER NOT NULL DEFAULT 0;

-- Composite index so per-invoice lines are returned in display order
-- without a sort over the whole invoice_id bucket.
CREATE INDEX IF NOT EXISTS idx_invoice_lines_invoice_position
  ON invoice_lines (invoice_id, position);