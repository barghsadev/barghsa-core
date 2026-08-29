-- Migration 0052: Invoice amount CHECK constraints (T-04.1.01.04)
--
-- Enforces the two invoice amount invariants at the database level:
--   1. paid_amount   <= total_amount     (never pay more than the total)
--   2. refunded_amount <= paid_amount    (never refund more than was paid)
--
-- These are the same constraints declared on the Drizzle `invoices` table
-- in packages/db/src/schema/invoices.ts (ck_paid_not_exceeds_total,
-- ck_refund_not_exceeds_paid). Drizzle does not emit table-level CHECKs
-- in its generated migrations, so they live here in the hand-written
-- migration — exactly like migrations 0041/0048/0050.
--
-- Strategy (idempotent for both fresh and pre-existing databases):
--   * CREATE TABLE IF NOT EXISTS — a fresh database that has never had the
--     invoices table (no earlier migration creates it; dev relies on
--     `drizzle-kit push`) gets the full table WITH both constraints.
--   * DO-block backfill — a database that already has an `invoices` table
--     created from an older schema (without the named constraints) gets the
--     two CHECKs added individually. Each ALTER is guarded by a
--     pg_constraint existence check, so re-running is a no-op.
--
-- Rollback:
--   ALTER TABLE invoices DROP CONSTRAINT IF EXISTS ck_paid_not_exceeds_total;
--   ALTER TABLE invoices DROP CONSTRAINT IF EXISTS ck_refund_not_exceeds_paid;
--   DROP TABLE IF EXISTS invoices CASCADE;   -- only if created by this migration

-- ---------------------------------------------------------------------------
-- 1. Create the invoices table (if absent) with both constraints inline.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS invoices (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v7(),
  profile_id UUID NOT NULL REFERENCES profiles(id) ON DELETE RESTRICT,
  order_id UUID REFERENCES orders(id) ON DELETE SET NULL,
  contract_id TEXT,
  state invoice_state NOT NULL DEFAULT 'Draft',
  total_amount BIGINT NOT NULL CHECK (total_amount >= 0),
  paid_amount BIGINT NOT NULL DEFAULT 0 CHECK (paid_amount >= 0),
  refunded_amount BIGINT NOT NULL DEFAULT 0 CHECK (refunded_amount >= 0),
  issued_at TIMESTAMPTZ,
  payable_from TIMESTAMPTZ,
  due_at TIMESTAMPTZ,
  cancelled_at TIMESTAMPTZ,
  metadata JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT ck_paid_not_exceeds_total CHECK (paid_amount <= total_amount),
  CONSTRAINT ck_refund_not_exceeds_paid CHECK (refunded_amount <= paid_amount)
);

-- ---------------------------------------------------------------------------
-- 2. Idempotent backfill for databases whose invoices table predates the
--    named constraints (e.g. created by an earlier drizzle-kit push).
--    Adds the two amount invariants AND the non-negative column checks so a
--    backfilled table ends up with exactly the same guard surface as one
--    created by this migration. Notes:
--      * to_regclass resolves against search_path — the same relation the
--        CREATE TABLE IF NOT EXISTS above touches.
--      * If a legacy table already holds rows that violate a constraint,
--        the ALTER fails loudly and the migration stops. Violating legacy
--        data must be reconciled before applying 0052 (acceptable: the
--        whole point of the constraint is that such rows must not exist).
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF to_regclass('invoices') IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1 FROM pg_constraint
      WHERE conname = 'ck_paid_not_exceeds_total' AND conrelid = 'invoices'::regclass
    ) THEN
      ALTER TABLE invoices
        ADD CONSTRAINT ck_paid_not_exceeds_total
        CHECK (paid_amount <= total_amount);
    END IF;

    IF NOT EXISTS (
      SELECT 1 FROM pg_constraint
      WHERE conname = 'ck_refund_not_exceeds_paid' AND conrelid = 'invoices'::regclass
    ) THEN
      ALTER TABLE invoices
        ADD CONSTRAINT ck_refund_not_exceeds_paid
        CHECK (refunded_amount <= paid_amount);
    END IF;

    IF NOT EXISTS (
      SELECT 1 FROM pg_constraint
      WHERE conname = 'ck_invoices_total_amount_nonneg' AND conrelid = 'invoices'::regclass
    ) THEN
      ALTER TABLE invoices
        ADD CONSTRAINT ck_invoices_total_amount_nonneg
        CHECK (total_amount >= 0);
    END IF;

    IF NOT EXISTS (
      SELECT 1 FROM pg_constraint
      WHERE conname = 'ck_invoices_paid_amount_nonneg' AND conrelid = 'invoices'::regclass
    ) THEN
      ALTER TABLE invoices
        ADD CONSTRAINT ck_invoices_paid_amount_nonneg
        CHECK (paid_amount >= 0);
    END IF;

    IF NOT EXISTS (
      SELECT 1 FROM pg_constraint
      WHERE conname = 'ck_invoices_refunded_amount_nonneg' AND conrelid = 'invoices'::regclass
    ) THEN
      ALTER TABLE invoices
        ADD CONSTRAINT ck_invoices_refunded_amount_nonneg
        CHECK (refunded_amount >= 0);
    END IF;
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 3. Query indexes (idempotent).
-- ---------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_invoices_profile_id ON invoices (profile_id);
CREATE INDEX IF NOT EXISTS idx_invoices_state ON invoices (state);
CREATE INDEX IF NOT EXISTS idx_invoices_due_at ON invoices (due_at);
CREATE INDEX IF NOT EXISTS idx_invoices_order_id ON invoices (order_id);
