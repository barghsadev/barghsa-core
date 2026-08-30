-- Migration 0058: Invoice calculation snapshot (T-04.1.02.08)
--
-- Store a dedicated JSONB document on every invoice that records:
--   * all calculation inputs (lines, quantity, unit price, VAT rate,
--     taxability, order-level gift discount);
--   * intermediate rounding steps (VAT half-up to nearest IRR: numerator,
--     denominator, truncated quotient, remainder, whether half-up applied);
--   * final totals (subtotal, VAT, discount, invoice total).
--
-- S-04.1.02 requires invoices to snapshot prices, VAT rate, product
-- composition and gift-code discount at creation time so later rate or
-- price changes cannot rewrite issued money. T-04.1.02.09 replays this
-- document through the same calculation module and asserts identical
-- totals. Amounts are stored as decimal-digit strings so int8 IRR values
-- survive JSON without Number.MAX_SAFE_INTEGER truncation.
--
-- Nullable: existing invoices (and any row created before this column
-- existed) remain valid. New manual/auto invoices populate the column at
-- INSERT. Expand/migrate/contract — no NOT NULL, no rewrite of issued
-- lines.
--
-- Idempotent: ADD COLUMN IF NOT EXISTS makes re-runs a no-op.
--
-- Rollback:
--   ALTER TABLE invoices DROP COLUMN IF EXISTS invoice_calculation_snapshot;

ALTER TABLE invoices
  ADD COLUMN IF NOT EXISTS invoice_calculation_snapshot JSONB;
