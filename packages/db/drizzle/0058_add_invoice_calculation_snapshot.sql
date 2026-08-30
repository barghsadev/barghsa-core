-- Migration 0058: Invoice calculation snapshot JSONB (T-04.1.02.08)
--
-- README §Invoices: "The invoice stores inputs, rounding results, and
-- totals so they can be reproduced later." S-04.1.02 requires a dedicated
-- `invoice_calculation_snapshot` JSONB column (not the generic `metadata`
-- bag) holding:
--   * calculation inputs (per-line quantity / unit price / VAT rate /
--     taxability, plus the order-level gift discount);
--   * intermediate rounding steps (VAT half-up operands, truncated
--     quotient, remainder, exact-half flag, rounded IRR);
--   * final totals (subtotal, VAT, discount, invoice total).
--
-- Expand/migrate/contract: the column is nullable so existing rows (and
-- invoices created before this lands) remain valid. Invoice-generation
-- services write the snapshot on INSERT; T-04.1.02.09 replays it.
--
-- Idempotent: ADD COLUMN IF NOT EXISTS makes re-runs a no-op.
--
-- Rollback:
--   ALTER TABLE invoices DROP COLUMN IF EXISTS invoice_calculation_snapshot;

ALTER TABLE invoices
  ADD COLUMN IF NOT EXISTS invoice_calculation_snapshot JSONB;
