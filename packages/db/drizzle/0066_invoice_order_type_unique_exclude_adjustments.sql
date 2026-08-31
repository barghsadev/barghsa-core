-- Migration 0066: Permit adjustment invoices on (order_id, type)
-- (T-04.1.05.03)
--
-- T-04.1.05.02's uq_invoices_order_id_type uniquely indexes (order_id, type)
-- for every row whose replaces_invoice_id IS NULL. createAdjustmentInvoice
-- copies the original order_id and inserts a staff adjustment with type
-- 'manual' and adjustment_for_invoice_id set, so:
--   * adjusting a paid order-linked manual invoice collides with the
--     still-present original (same order_id + type);
--   * a second adjustment of type 'manual' on the same order collides
--     with the first;
--   * adjusting an auto invoice whose order already has a live manual
--     invoice collides with that sibling.
--
-- Ordinary idempotency ("an order produces at most one non-correction
-- invoice of a given type") is preserved by rewriting the unique index as
-- a partial index over rows whose correction FKs are both NULL.
-- Adjustment invoices set adjustment_for_invoice_id on insert, so they
-- never occupy the ordinary uniqueness slot. Paid originals remain in
-- the index and continue to block a second ordinary auto/manual invoice.
--
-- Guard: skip the rewrite when `type`, `replaces_invoice_id`, or
-- `adjustment_for_invoice_id` is missing so journaled migrate() against
-- a 0052-era invoices table is a no-op instead of failing.
--
-- Idempotent: DROP INDEX IF EXISTS + CREATE UNIQUE INDEX IF NOT EXISTS.
--
-- Rollback:
--   DROP INDEX IF EXISTS uq_invoices_order_id_type;
--   CREATE UNIQUE INDEX IF NOT EXISTS uq_invoices_order_id_type
--     ON invoices (order_id, type)
--     WHERE replaces_invoice_id IS NULL;

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

  IF NOT EXISTS (
    SELECT 1
      FROM information_schema.columns
     WHERE table_schema = current_schema()
       AND table_name = 'invoices'
       AND column_name = 'adjustment_for_invoice_id'
  ) THEN
    RETURN;
  END IF;

  DROP INDEX IF EXISTS uq_invoices_order_id_type;

  CREATE UNIQUE INDEX IF NOT EXISTS uq_invoices_order_id_type
    ON invoices (order_id, type)
    WHERE replaces_invoice_id IS NULL AND adjustment_for_invoice_id IS NULL;
END $$;
