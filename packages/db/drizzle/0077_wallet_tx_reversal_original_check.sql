-- Migration 0077: reversal rows must point at an original
-- (T-04.2.04.01)
--
-- Expand: CHECK `chk_wallet_tx_reversal_original` so
--   type = 'reversal'  <=>  reverses_transaction_id IS NOT NULL
-- The original ledger row is never rewritten. A compensating
-- `reversal` row always carries the unique original pointer; unmatched
-- `compensating` exceptions and every other type leave it NULL.
--
-- Guard: no-op when wallet_transactions is missing (pre-0068 schema)
-- or when reverses_transaction_id is missing (pre-0074 schema).
-- Idempotent: ADD CONSTRAINT only when the named constraint is absent.
--
-- If a legacy table already holds rows that violate the invariant, the
-- ALTER fails loudly and the migration stops. reverseTransaction always
-- writes the pointer; violating rows must be reconciled first.
--
-- Rollback:
--   ALTER TABLE wallet_transactions
--     DROP CONSTRAINT IF EXISTS chk_wallet_tx_reversal_original;

DO $$
BEGIN
  IF to_regclass('wallet_transactions') IS NULL THEN
    RETURN;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = current_schema()
      AND table_name = 'wallet_transactions'
      AND column_name = 'reverses_transaction_id'
  ) THEN
    RETURN;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'chk_wallet_tx_reversal_original'
      AND conrelid = 'wallet_transactions'::regclass
  ) THEN
    ALTER TABLE wallet_transactions
      ADD CONSTRAINT chk_wallet_tx_reversal_original
      CHECK (
        (type = 'reversal' AND reverses_transaction_id IS NOT NULL)
        OR (type <> 'reversal' AND reverses_transaction_id IS NULL)
      );
  END IF;
END $$;
