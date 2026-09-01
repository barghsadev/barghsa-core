-- Migration 0072: unique bank-receipt attachment on wallet_transactions
-- (T-04.2.02.03)
--
-- Expand: nullable `receipt_attachment_key` plus a partial unique index
-- so one stored receipt can back at most one wallet top-up. Online
-- top-ups leave the column NULL (many NULLs are allowed). Retrying the
-- same submission still returns the original row because that path
-- never inserts a second ledger entry.
--
-- Guard: no-op when wallet_transactions is missing (pre-0068 schema).
-- Idempotent: ADD COLUMN IF NOT EXISTS + CREATE UNIQUE INDEX IF NOT EXISTS.
--
-- Rollback:
--   DROP INDEX IF EXISTS uq_wallet_tx_receipt_attachment;
--   ALTER TABLE wallet_transactions DROP COLUMN IF EXISTS receipt_attachment_key;

DO $$
BEGIN
  IF to_regclass('wallet_transactions') IS NULL THEN
    RETURN;
  END IF;

  ALTER TABLE wallet_transactions
    ADD COLUMN IF NOT EXISTS receipt_attachment_key TEXT;

  CREATE UNIQUE INDEX IF NOT EXISTS uq_wallet_tx_receipt_attachment
    ON wallet_transactions (receipt_attachment_key)
    WHERE receipt_attachment_key IS NOT NULL;
END $$;
