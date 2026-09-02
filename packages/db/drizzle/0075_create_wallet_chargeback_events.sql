-- Migration 0075: wallet_chargeback_events (T-04.2.04.02)
--
-- Durable, unique event-id ledger for authenticated provider
-- chargeback / reversal notifications. Re-delivered events with the
-- same event_id insert nothing so reverseTransaction is not driven
-- twice from a captured payload.
--
-- original_transaction_id → wallet_transactions.id (RESTRICT, nullable)
-- reversal_transaction_id → wallet_transactions.id (RESTRICT, nullable)
-- wallet_id               → wallets.profile_id (RESTRICT, nullable)
--
-- Unmatched notifications keep the FK columns NULL: they are the
-- general exception record, not a silent rewrite of wallet history.
--
-- Guard: no-op when wallets / wallet_transactions are missing (pre-0068
-- schema) so isolated migrate() tests that start after 0068's journal
-- head still apply later tags.
-- Idempotent: CREATE TABLE IF NOT EXISTS + guarded unique/lookup indexes.
--
-- Rollback:
--   DROP TABLE IF EXISTS wallet_chargeback_events CASCADE;

DO $$
BEGIN
  IF to_regclass('wallets') IS NULL OR to_regclass('wallet_transactions') IS NULL THEN
    RETURN;
  END IF;

  CREATE TABLE IF NOT EXISTS wallet_chargeback_events (
    id                         UUID PRIMARY KEY DEFAULT uuid_generate_v7(),
    event_id                   TEXT NOT NULL,
    original_transaction_id    UUID REFERENCES wallet_transactions(id) ON DELETE RESTRICT,
    reversal_transaction_id    UUID REFERENCES wallet_transactions(id) ON DELETE RESTRICT,
    wallet_id                  UUID REFERENCES wallets(profile_id) ON DELETE RESTRICT,
    status                     TEXT NOT NULL
      CONSTRAINT chk_wallet_chargeback_events_status
        CHECK (status IN ('processing', 'reversed', 'unmatched', 'unresolved', 'duplicate')),
    match_method               TEXT
      CONSTRAINT chk_wallet_chargeback_events_match_method
        CHECK (match_method IS NULL OR match_method IN ('merchant_order_id', 'provider_ref_id', 'authority')),
    raw                        JSONB,
    created_at                 TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );

  CREATE UNIQUE INDEX IF NOT EXISTS uq_wallet_chargeback_event_id
    ON wallet_chargeback_events (event_id);
  CREATE INDEX IF NOT EXISTS idx_wce_original_tx
    ON wallet_chargeback_events (original_transaction_id);
  CREATE INDEX IF NOT EXISTS idx_wce_wallet
    ON wallet_chargeback_events (wallet_id);
  CREATE INDEX IF NOT EXISTS idx_wce_status
    ON wallet_chargeback_events (status);
END $$;
