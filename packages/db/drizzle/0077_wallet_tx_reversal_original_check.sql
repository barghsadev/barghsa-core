-- Migration 0077: reversal rows must point at an original
-- (T-04.2.04.01) — expand / migrate phase
--
-- Expand: CHECK `chk_wallet_tx_reversal_original` so
--   type = 'reversal'  <=>  reverses_transaction_id IS NOT NULL
-- The original ledger row is never rewritten. A compensating
-- `reversal` row always carries the unique original pointer; unmatched
-- `compensating` exceptions and every other type leave it NULL.
--
-- The previous schema (0074) and WalletService.credit/debit allowed
-- `type = 'reversal'` without `reverses_transaction_id`. The CHECK is
-- therefore added NOT VALID: new writes are enforced, existing rows
-- are not scanned. VALIDATE belongs in a later contract-phase
-- migration after operators have reconciled any legacy violators.
--
-- Migrate (report, do not rewrite ledger history):
--   Rows that already violate the invariant are copied into
--   `wallet_tx_reversal_check_violations`. Guessing an original pointer
--   or silently relabeling `reversal` → `compensating` would edit
--   wallet history. Finance must reconcile each reported row before
--   the later VALIDATE migration:
--     1. SELECT * FROM wallet_tx_reversal_check_violations;
--     2. If the original is uniquely identifiable and not already
--        reversed, attach `reverses_transaction_id` with an audited
--        staff correction.
--     3. Otherwise leave the row as a general unmatched exception by
--        changing `type` to `compensating` with an audited staff
--        action (do not invent an original).
--     4. DELETE the preflight row once the ledger row satisfies the
--        CHECK. Only then run VALIDATE CONSTRAINT.
--
-- Guard: no-op when wallet_transactions is missing (pre-0068 schema)
-- or when reverses_transaction_id is missing (pre-0074 schema).
-- Idempotent: ADD CONSTRAINT only when the named constraint is absent;
-- preflight INSERT uses ON CONFLICT DO NOTHING.
--
-- Rollback:
--   ALTER TABLE wallet_transactions
--     DROP CONSTRAINT IF EXISTS chk_wallet_tx_reversal_original;
--   DROP TABLE IF EXISTS wallet_tx_reversal_check_violations;

DO $$
DECLARE
  violation_count INTEGER := 0;
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

  CREATE TABLE IF NOT EXISTS wallet_tx_reversal_check_violations (
    transaction_id UUID PRIMARY KEY,
    wallet_id UUID NOT NULL,
    type TEXT NOT NULL,
    amount BIGINT NOT NULL,
    state TEXT NOT NULL,
    reverses_transaction_id UUID,
    reported_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );

  INSERT INTO wallet_tx_reversal_check_violations (
    transaction_id,
    wallet_id,
    type,
    amount,
    state,
    reverses_transaction_id
  )
  SELECT
    wt.id,
    wt.wallet_id,
    wt.type,
    wt.amount,
    wt.state,
    wt.reverses_transaction_id
  FROM wallet_transactions wt
  WHERE (
    (wt.type = 'reversal' AND wt.reverses_transaction_id IS NULL)
    OR (wt.type <> 'reversal' AND wt.reverses_transaction_id IS NOT NULL)
  )
  ON CONFLICT (transaction_id) DO NOTHING;

  GET DIAGNOSTICS violation_count = ROW_COUNT;
  RAISE NOTICE
    '0077: reported % legacy wallet_transactions row(s) violating chk_wallet_tx_reversal_original. Reconcile wallet_tx_reversal_check_violations before the later VALIDATE migration.',
    violation_count;

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
      ) NOT VALID;
  END IF;
END $$;
