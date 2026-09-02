-- Migration 0076: online Pending top-up expiry candidate index
-- (T-04.2.02.07)
--
-- Expand: partial index matching the worker expiry cron
-- (`type = 'topup' AND state = 'Pending' AND metadata.channel = 'online'`)
-- so each tick can drain oldest-created intents without a sequential
-- scan of every ledger row. Bank-receipt Pendings are excluded.
--
-- Guard: no-op when wallet_transactions is missing (pre-0068 schema).
-- Idempotent: CREATE INDEX IF NOT EXISTS.
--
-- Rollback:
--   DROP INDEX IF EXISTS idx_wallet_tx_online_pending_created;

DO $$
BEGIN
  IF to_regclass('wallet_transactions') IS NULL THEN
    RETURN;
  END IF;

  CREATE INDEX IF NOT EXISTS idx_wallet_tx_online_pending_created
    ON wallet_transactions (created_at ASC, id ASC)
    WHERE type = 'topup'
      AND state = 'Pending'
      AND metadata->>'channel' = 'online';
END $$;
