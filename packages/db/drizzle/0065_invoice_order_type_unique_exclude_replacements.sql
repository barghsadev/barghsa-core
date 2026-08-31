-- Migration 0065: Permit correction-chain invoices on (order_id, type)
-- (T-04.1.05.02)
--
-- T-04.1.02.06's uq_invoices_order_id_type uniquely indexes (order_id, type)
-- for every row, including cancelled originals and cancel+replace
-- successors. cancelAndReplaceInvoice copies the original order_id and
-- inserts a staff replacement with type 'manual', so:
--   * replacing an order-linked manual invoice collides with the still-
--     present original (same order_id + type);
--   * replacing an auto invoice whose order already has a live manual
--     invoice collides with that sibling.
--
-- Ordinary idempotency ("an order produces at most one non-replacement
-- invoice of a given type") is preserved by rewriting the unique index as
-- a partial index over rows whose replaces_invoice_id IS NULL. Correction
-- replacements set that column on insert, so they never occupy the
-- ordinary uniqueness slot. Cancelled originals remain in the index and
-- continue to block a second ordinary auto/manual invoice for the order.
--
-- Guard: skip the rewrite when `type` or `replaces_invoice_id` is missing
-- so journaled migrate() against a 0052-era invoices table (no 0057/0064
-- applied as journal tags) is a no-op instead of failing.
--
-- Idempotent: DROP INDEX IF EXISTS + CREATE UNIQUE INDEX IF NOT EXISTS.
--
-- Rollback:
--   DROP INDEX IF EXISTS uq_invoices_order_id_type;
--   CREATE UNIQUE INDEX IF NOT EXISTS uq_invoices_order_id_type
--     ON invoices (order_id, type);

DO $$
BEGIN
  IF to_regclass('invoices') IS NULL THEN
    RETURN;
  END IF;

  IF NOT EXISTS (
    SELECT 1
      FROM information_schema.columns
     WHERE table_schema = current_schema()
       AND table_name = 'invoices'
       AND column_name = 'type'
  ) THEN
    RETURN;
  END IF;

  IF NOT EXISTS (
    SELECT 1
      FROM information_schema.columns
     WHERE table_schema = current_schema()
       AND table_name = 'invoices'
       AND column_name = 'replaces_invoice_id'
  ) THEN
    RETURN;
  END IF;

  DROP INDEX IF EXISTS uq_invoices_order_id_type;

  CREATE UNIQUE INDEX IF NOT EXISTS uq_invoices_order_id_type
    ON invoices (order_id, type)
    WHERE replaces_invoice_id IS NULL;
END $$;
