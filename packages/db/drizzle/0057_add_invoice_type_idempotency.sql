-- Migration 0057: Invoice type + idempotency unique index (T-04.1.02.06)
--
-- Guarantee: the same order cannot produce duplicate invoices. S-04.1.02
-- requires order submission to create exactly one linked invoice atomically,
-- so the database must refuse a second invoice for the same order.
--
--   * type — TEXT discriminator recording the invoice source/kind:
--            'auto' (system-generated from an order) or 'manual' (staff
--            created), with future contract / consultation kinds as the
--            owning epics land. Column is nullable so existing manual
--            invoices (which carry no origin) remain valid without a
--            forced default.
--   * uq_invoices_order_id_type — UNIQUE index on (order_id, type).
--     PostgreSQL treats NULLs as distinct, so manual invoices (order_id
--     NULL) and legacy rows (type NULL) never collide with each other or
--     with order-derived rows; exactly one auto invoice may exist per order.
--
-- Existing rows are backfilled from the legacy metadata origin payload
-- (metadata->>'source' = 'auto' | 'manual') so a pre-populated table keeps a
-- truthful type and the unique index applies retroactively. There are zero
-- production rows today, but the backfill keeps the migration correct if it
-- ever runs on a populated table (CREATE UNIQUE INDEX also fails loudly if
-- duplicates already exist, which is the desired fail-safe).
--
-- Idempotency: ADD COLUMN IF NOT EXISTS + UPDATE (no-op on no rows) +
-- CREATE UNIQUE INDEX IF NOT EXISTS make re-runs safe.
--
-- Rollback:
--   DROP INDEX IF EXISTS uq_invoices_order_id_type;
--   ALTER TABLE invoices DROP COLUMN IF EXISTS type;

ALTER TABLE invoices
  ADD COLUMN IF NOT EXISTS type TEXT;

UPDATE invoices
   SET type = COALESCE(metadata->>'source', type)
 WHERE type IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_invoices_order_id_type
  ON invoices (order_id, type);
