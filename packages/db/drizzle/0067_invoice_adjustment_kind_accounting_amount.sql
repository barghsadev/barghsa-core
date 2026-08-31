-- Migration 0067: First-class adjustment kind + signed accounting amount
-- (T-04.1.05.03)
--
-- createAdjustmentInvoice(amount) with a negative amount is a credit note,
-- not a customer payable. `total_amount` stays non-negative (CHECK from
-- 0052). Without a first-class discriminator, outstanding-invoice queries
-- that treat every Unpaid row as customer debt would count the credit as
-- additional liability.
--
-- Expand:
--   * `adjustment_kind` TEXT NULL — 'charge' | 'credit' on adjustment
--     rows; NULL on ordinary invoices.
--   * `accounting_amount` BIGINT GENERATED ALWAYS — signed IRR
--     contribution to customer liability (`-total_amount` for credits,
--     `total_amount` otherwise). Existing rows backfill automatically.
--
-- CHECK `ck_invoices_adjustment_kind_matches_link` ties kind to
-- `adjustment_for_invoice_id` so a credit cannot be stored as an
-- ordinary unpaid invoice.
--
-- Guard: skip when `invoices` is missing so journaled migrate() against
-- a pre-invoice schema is a no-op. The kind/link CHECK is added only
-- when `adjustment_for_invoice_id` exists (migration 0064).
--
-- Idempotent: column existence + pg_constraint existence checks.
--
-- Rollback:
--   ALTER TABLE invoices DROP CONSTRAINT IF EXISTS
--     ck_invoices_adjustment_kind_matches_link;
--   ALTER TABLE invoices DROP COLUMN IF EXISTS accounting_amount;
--   ALTER TABLE invoices DROP COLUMN IF EXISTS adjustment_kind;

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
       AND column_name = 'adjustment_kind'
  ) THEN
    ALTER TABLE invoices
      ADD COLUMN adjustment_kind TEXT
      CONSTRAINT ck_invoices_adjustment_kind
        CHECK (adjustment_kind IS NULL OR adjustment_kind IN ('charge', 'credit'));
  END IF;

  IF NOT EXISTS (
    SELECT 1
      FROM information_schema.columns
     WHERE table_schema = current_schema()
       AND table_name = 'invoices'
       AND column_name = 'accounting_amount'
  ) THEN
    ALTER TABLE invoices
      ADD COLUMN accounting_amount BIGINT
      GENERATED ALWAYS AS (
        CASE WHEN adjustment_kind = 'credit' THEN -total_amount ELSE total_amount END
      ) STORED;
  END IF;

  IF EXISTS (
    SELECT 1
      FROM information_schema.columns
     WHERE table_schema = current_schema()
       AND table_name = 'invoices'
       AND column_name = 'adjustment_for_invoice_id'
  ) AND NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'ck_invoices_adjustment_kind_matches_link'
       AND conrelid = 'invoices'::regclass
  ) THEN
    ALTER TABLE invoices
      ADD CONSTRAINT ck_invoices_adjustment_kind_matches_link
      CHECK (
        (adjustment_for_invoice_id IS NULL) = (adjustment_kind IS NULL)
        AND (
          adjustment_kind IS NULL
          OR adjustment_kind IN ('charge', 'credit')
        )
      );
  END IF;
END $$;
