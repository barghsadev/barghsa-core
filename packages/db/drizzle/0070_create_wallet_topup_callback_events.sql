-- Migration 0070: wallet_topup_callback_events (T-04.2.02.02)
--
-- Durable, unique event-id ledger for authenticated online top-up
-- provider callbacks. Re-delivered or replayed events with the same
-- event_id insert nothing so WalletService.credit() is not driven twice
-- from a captured payload.
--
-- pending_transaction_id → wallet_transactions.id (RESTRICT)
-- wallet_id              → wallets.profile_id (RESTRICT)
--
-- Idempotent: CREATE TABLE IF NOT EXISTS + guarded unique/lookup indexes.
--
-- Rollback:
--   DROP TABLE IF EXISTS wallet_topup_callback_events CASCADE;

CREATE TABLE IF NOT EXISTS wallet_topup_callback_events (
  id                       UUID PRIMARY KEY DEFAULT uuid_generate_v7(),
  event_id                 TEXT NOT NULL,
  pending_transaction_id   UUID NOT NULL REFERENCES wallet_transactions(id) ON DELETE RESTRICT,
  wallet_id                UUID NOT NULL REFERENCES wallets(profile_id) ON DELETE RESTRICT,
  status                   TEXT NOT NULL
    CONSTRAINT chk_wallet_topup_callback_events_status
      CHECK (status IN ('credited', 'unpaid', 'duplicate')),
  raw                      JSONB,
  created_at               TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_wallet_topup_callback_event_id
  ON wallet_topup_callback_events (event_id);
CREATE INDEX IF NOT EXISTS idx_wtce_pending_tx
  ON wallet_topup_callback_events (pending_transaction_id);
CREATE INDEX IF NOT EXISTS idx_wtce_wallet
  ON wallet_topup_callback_events (wallet_id);
