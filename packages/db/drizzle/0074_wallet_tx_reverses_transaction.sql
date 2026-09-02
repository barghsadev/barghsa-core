-- Migration 0074: unique original pointer on wallet reversal rows
-- (T-04.2.04.01)
--
-- Expand: nullable `reverses_transaction_id` self-FK plus a partial
-- unique index so one completed ledger row can be reversed at most
-- once. Non-reversal rows leave the column NULL (many NULLs are
-- allowed). Retrying `reverseTransaction` with the same idempotency
-- key still returns the original reversal because that path never
-- inserts a second ledger entry.
--
-- The original row is not rewritten. The compensating `reversal` row
-- posts the opposite signed amount; this column is only the uniqueness
-- and traceability link.
--
-- Guard: no-op when wallet_transactions is missing (pre-0068 schema).
-- Idempotent: ADD COLUMN IF NOT EXISTS + guarded ADD CONSTRAINT +
-- CREATE UNIQUE INDEX IF NOT EXISTS.
--
-- Rollback:
--   DROP INDEX IF EXISTS uq_wallet_tx_reverses_transaction;
--   ALTER TABLE wallet_transactions
--     DROP CONSTRAINT IF EXISTS fk_wallet_tx_reverses_transaction;
--   ALTER TABLE wallet_transactions
--     DROP COLUMN IF EXISTS reverses_transaction_id;

DO $$
BEGIN
  IF to_regclass('wallet_transactions') IS NULL THEN
    RETURN;
  END IF;

  ALTER TABLE wallet_transactions
    ADD COLUMN IF NOT EXISTS reverses_transaction_id UUID;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'fk_wallet_tx_reverses_transaction'
      AND conrelid = 'wallet_transactions'::regclass
  ) THEN
    ALTER TABLE wallet_transactions
      ADD CONSTRAINT fk_wallet_tx_reverses_transaction
      FOREIGN KEY (reverses_transaction_id)
      REFERENCES wallet_transactions (id)
      ON DELETE RESTRICT;
  END IF;

  CREATE UNIQUE INDEX IF NOT EXISTS uq_wallet_tx_reverses_transaction
    ON wallet_transactions (reverses_transaction_id)
    WHERE reverses_transaction_id IS NOT NULL;
END $$;
