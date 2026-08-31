-- Migration 0064: Invoice correction self-references (T-04.1.05.01)
--
-- S-04.1.05 links a correction invoice to the invoice it corrects:
--   * replaces_invoice_id       — pre-payment cancel+replace: the
--                                 corrected invoice points at the
--                                 cancelled original it replaces.
--   * adjustment_for_invoice_id — post-payment adjustment (positive
--                                 additional charge or negative credit)
--                                 points at the paid invoice it adjusts.
--
-- Both are nullable UUID self-FKs → invoices(id) ON DELETE RESTRICT.
-- Existing rows stay valid with NULL (expand/migrate/contract — no
-- backfill, no NOT NULL). An original cannot be deleted while a
-- replacement or adjustment still points at it.
--
-- Lookup indexes support walking the correction chain from the original
-- (T-04.1.05.04).
--
-- Idempotent: ADD COLUMN IF NOT EXISTS + CREATE INDEX IF NOT EXISTS
-- make re-runs a no-op.
--
-- Locking note: ADD COLUMN of a nullable UUID is a metadata-only change
-- on modern PostgreSQL. CREATE INDEX (non-CONCURRENTLY) takes ACCESS
-- EXCLUSIVE for the duration of the build — harmless while invoices is
-- still small. Plan CREATE INDEX CONCURRENTLY outside a transaction if
-- this ever ships against a large populated table.
--
-- Rollback:
--   ALTER TABLE invoices DROP COLUMN IF EXISTS replaces_invoice_id;
--   ALTER TABLE invoices DROP COLUMN IF EXISTS adjustment_for_invoice_id;

ALTER TABLE invoices
  ADD COLUMN IF NOT EXISTS replaces_invoice_id UUID
    REFERENCES invoices(id) ON DELETE RESTRICT;

ALTER TABLE invoices
  ADD COLUMN IF NOT EXISTS adjustment_for_invoice_id UUID
    REFERENCES invoices(id) ON DELETE RESTRICT;

CREATE INDEX IF NOT EXISTS idx_invoices_replaces_invoice_id
  ON invoices (replaces_invoice_id);
CREATE INDEX IF NOT EXISTS idx_invoices_adjustment_for_invoice_id
  ON invoices (adjustment_for_invoice_id);
