-- Migration 0079: bank_receipt_attachment_claims (T-04.3.01.02)
--
-- One storage object may back either a wallet top-up or an invoice
-- bank receipt, never both. Wallet `receipt_attachment_key` and
-- `bank_receipts.attachment_key` are unique only inside their own
-- tables; this claim table is the cross-flow uniqueness gate.
--
-- Guarantees:
--   - storage_key is unique (primary key);
--   - claim_type is wallet_topup | invoice_receipt;
--   - storage_key is non-blank;
--   - existing wallet and invoice attachment keys are backfilled;
--   - a key already present in both source tables aborts the migration.
--
-- Idempotent: CREATE TABLE IF NOT EXISTS + ON CONFLICT DO NOTHING
-- backfill. Source tables are optional so isolated migrate() tests that
-- skip 0068/0078 still create the claim table.
--
-- Rollback:
--   DROP TABLE IF EXISTS bank_receipt_attachment_claims CASCADE;
--   DROP FUNCTION IF EXISTS update_bank_receipt_attachment_claims_updated_at();

CREATE TABLE IF NOT EXISTS bank_receipt_attachment_claims (
  storage_key TEXT PRIMARY KEY
    CONSTRAINT chk_bank_receipt_attachment_claims_storage_key_nonblank
      CHECK (length(trim(storage_key)) > 0),
  claim_type TEXT NOT NULL
    CONSTRAINT chk_bank_receipt_attachment_claims_type
      CHECK (claim_type IN ('wallet_topup', 'invoice_receipt')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE OR REPLACE FUNCTION update_bank_receipt_attachment_claims_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_bank_receipt_attachment_claims_updated_at
  ON bank_receipt_attachment_claims;

CREATE TRIGGER trg_bank_receipt_attachment_claims_updated_at
  BEFORE UPDATE ON bank_receipt_attachment_claims
  FOR EACH ROW
  EXECUTE FUNCTION update_bank_receipt_attachment_claims_updated_at();

DO $$
DECLARE
  has_wallet_tx boolean;
  has_attachment_col boolean;
  has_bank_receipts boolean;
  collision boolean;
BEGIN
  -- Plan-time references to wallet_transactions/bank_receipts fail when
  -- isolated migrate() tests skip earlier journal entries. Look up the
  -- relations first, then EXECUTE the backfill only when they exist.
  has_wallet_tx := to_regclass('wallet_transactions') IS NOT NULL;
  has_bank_receipts := to_regclass('bank_receipts') IS NOT NULL;
  has_attachment_col := has_wallet_tx AND EXISTS (
    SELECT 1
      FROM information_schema.columns
     WHERE table_schema = current_schema()
       AND table_name = 'wallet_transactions'
       AND column_name = 'receipt_attachment_key'
  );

  IF has_wallet_tx AND has_bank_receipts AND has_attachment_col THEN
    EXECUTE $q$
      SELECT EXISTS (
        SELECT 1
          FROM wallet_transactions w
          JOIN bank_receipts b
            ON b.attachment_key = w.receipt_attachment_key
         WHERE w.receipt_attachment_key IS NOT NULL
      )
    $q$ INTO collision;
    IF collision THEN
      RAISE EXCEPTION
        'bank_receipt_attachment_claims: storage_key already claimed by both wallet_transactions and bank_receipts';
    END IF;
  END IF;

  IF has_attachment_col THEN
    EXECUTE $q$
      INSERT INTO bank_receipt_attachment_claims (storage_key, claim_type)
      SELECT DISTINCT receipt_attachment_key, 'wallet_topup'
        FROM wallet_transactions
       WHERE receipt_attachment_key IS NOT NULL
         AND length(trim(receipt_attachment_key)) > 0
      ON CONFLICT (storage_key) DO NOTHING
    $q$;
  END IF;

  IF has_bank_receipts THEN
    EXECUTE $q$
      INSERT INTO bank_receipt_attachment_claims (storage_key, claim_type)
      SELECT DISTINCT attachment_key, 'invoice_receipt'
        FROM bank_receipts
       WHERE length(trim(attachment_key)) > 0
      ON CONFLICT (storage_key) DO NOTHING
    $q$;
  END IF;
END $$;
