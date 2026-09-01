-- Migration 0069: nonnegative available-balance CHECK on wallets (T-04.2.01.07)
--
-- Enforces the S-04.2.01 invariant at the database:
--   availableBalance = postedBalance - reservedBalance
--   CHECK ((posted_balance - reserved_balance) >= 0)
--
-- `available_balance` is NOT a stored column and is NOT a generated
-- STORED column (PostgreSQL 16 has no VIRTUAL generated columns). The
-- CHECK evaluates the derived expression in-place on INSERT/UPDATE, so
-- a trigger is also unnecessary.
--
-- Named constraint: chk_wallets_available_balance_nonneg
-- (mirrors the Drizzle `wallets` table extraConfig in
-- packages/db/src/schema/wallets.ts).
--
-- Strategy (idempotent for both fresh and pre-existing databases):
--   * CREATE TABLE IF NOT EXISTS — a database that somehow skipped 0068
--     still gets wallets WITH the CHECK inline.
--   * DO-block backfill — a database whose wallets table was created by
--     0068 / drizzle-kit push (without the named CHECK) gets
--     ALTER TABLE ... ADD CONSTRAINT. Guarded by pg_constraint so
--     re-running is a no-op.
--
-- If a legacy table already holds rows that violate the invariant, the
-- ALTER fails loudly and the migration stops. Violating legacy data
-- must be reconciled first (acceptable: the constraint exists so such
-- rows must not exist).
--
-- Rollback:
--   ALTER TABLE wallets DROP CONSTRAINT IF EXISTS chk_wallets_available_balance_nonneg;
--   DROP TABLE IF EXISTS wallets CASCADE;   -- only if created by this migration

-- ---------------------------------------------------------------------------
-- 1. Create the wallets table (if absent) with the derived-balance CHECK.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS wallets (
  profile_id UUID PRIMARY KEY REFERENCES profiles(id) ON DELETE RESTRICT,
  posted_balance BIGINT NOT NULL DEFAULT 0,
  reserved_balance BIGINT NOT NULL DEFAULT 0,
  version INTEGER NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT chk_wallets_available_balance_nonneg
    CHECK ((posted_balance - reserved_balance) >= 0)
);

-- ---------------------------------------------------------------------------
-- 2. Idempotent backfill for databases whose wallets table predates the
--    named CHECK (0068 CREATE TABLE IF NOT EXISTS wallets, or an earlier
--    drizzle-kit push). Notes:
--      * to_regclass resolves against search_path — the same relation the
--        CREATE TABLE IF NOT EXISTS above touches.
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF to_regclass('wallets') IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1 FROM pg_constraint
      WHERE conname = 'chk_wallets_available_balance_nonneg'
        AND conrelid = 'wallets'::regclass
    ) THEN
      ALTER TABLE wallets
        ADD CONSTRAINT chk_wallets_available_balance_nonneg
        CHECK ((posted_balance - reserved_balance) >= 0);
    END IF;
  END IF;
END $$;
