-- Migration 0053: Add invoice paid/overdue timestamps (T-04.1.01.06)
--
-- The InvoiceStateMachineService (T-04.1.01.03) records side-effect
-- timestamps on every transition:
--   * `paid_at`     — set when an invoice enters `Paid` (PayFromWallet or
--                     ConfirmBankReceipt), symmetric with issued/cancelled.
--   * `overdue_at`  — set when an invoice enters `Overdue` (MarkOverdue).
--
-- These columns were emitted by the service since 0019 but never existed
-- in the schema, so every real-DB PayFromWallet / MarkOverdue transition
-- failed with "column does not exist" (SQLSTATE 42703). The unit tests
-- mock the pg client and could not catch it; the integration suite for
-- T-04.1.01.06 surfaced it. This migration adds the missing columns.
--
-- Idempotent: ADD COLUMN IF NOT EXISTS makes re-runs a no-op, and the
-- guard works for both fresh databases and legacy tables that already
-- received the columns some other way.
--
-- Rollback:
--   ALTER TABLE invoices DROP COLUMN IF EXISTS paid_at;
--   ALTER TABLE invoices DROP COLUMN IF EXISTS overdue_at;

ALTER TABLE invoices
  ADD COLUMN IF NOT EXISTS paid_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS overdue_at TIMESTAMPTZ;