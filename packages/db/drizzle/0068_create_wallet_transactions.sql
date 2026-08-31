-- Migration 0068: wallet_transactions ledger (T-04.2.01.02)
--
-- Per-profile immutable money ledger (S-04.2.01). One row is one
-- credit, debit, reservation, release, reversal, or compensating entry.
--
-- wallet_transactions:
--   id              UUIDv7 PK
--   wallet_id       UUID FK wallets.profile_id ON DELETE RESTRICT
--   type            TEXT — topup | payment | refund | reservation |
--                    release | reversal | compensating
--   amount          BIGINT (IRR) — positive credit, negative debit; never 0
--   state           TEXT — Pending | Reserved | Completed | Failed |
--                    Rejected | Released | Reversed (default Pending)
--   idempotency_key TEXT UNIQUE — at-most-once money-moving commands
--   ref_id          TEXT nullable — related domain entity
--   description     TEXT nullable
--   metadata        JSONB NOT NULL DEFAULT {}
--   created_at / updated_at (audit columns)
--
-- Guarantees:
--   - type and state are closed enumerations (CHECK);
--   - amount is a signed int8 and never zero;
--   - idempotency_key is globally unique;
--   - deleting a wallet that still has ledger rows is RESTRICTed;
--   - lookup indexes on wallet_id, state, and type;
--   - updated_at maintained by trigger.
--
-- Scaffolding: T-04.2.01.01 defined `wallets` in Drizzle but never
-- shipped a numbered migration. CREATE TABLE IF NOT EXISTS wallets
-- gives the FK a target on greenfield databases without stealing
-- T-04.2.01.07 (available-balance CHECK / trigger).
--
-- Idempotent: CREATE TABLE IF NOT EXISTS + guarded indexes/triggers
-- make re-runs a no-op.
--
-- Rollback:
--   DROP TABLE IF EXISTS wallet_transactions CASCADE;
--   DROP FUNCTION IF EXISTS update_wallet_transactions_updated_at();

CREATE TABLE IF NOT EXISTS wallets (
  profile_id UUID PRIMARY KEY REFERENCES profiles(id) ON DELETE RESTRICT,
  posted_balance BIGINT NOT NULL DEFAULT 0,
  reserved_balance BIGINT NOT NULL DEFAULT 0,
  version INTEGER NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS wallet_transactions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v7(),
  wallet_id UUID NOT NULL REFERENCES wallets(profile_id) ON DELETE RESTRICT,
  type TEXT NOT NULL
    CONSTRAINT chk_wallet_transactions_type
      CHECK (type IN ('topup', 'payment', 'refund', 'reservation', 'release', 'reversal', 'compensating')),
  amount BIGINT NOT NULL
    CONSTRAINT chk_wallet_transactions_amount_nonzero
      CHECK (amount <> 0),
  state TEXT NOT NULL DEFAULT 'Pending'
    CONSTRAINT chk_wallet_transactions_state
      CHECK (state IN ('Pending', 'Reserved', 'Completed', 'Failed', 'Rejected', 'Released', 'Reversed')),
  idempotency_key TEXT NOT NULL,
  ref_id TEXT,
  description TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_wallet_tx_wallet_id ON wallet_transactions (wallet_id);
CREATE INDEX IF NOT EXISTS idx_wallet_tx_state ON wallet_transactions (state);
CREATE INDEX IF NOT EXISTS idx_wallet_tx_type ON wallet_transactions (type);
CREATE UNIQUE INDEX IF NOT EXISTS idx_wallet_tx_idempotency ON wallet_transactions (idempotency_key);

CREATE OR REPLACE FUNCTION update_wallet_transactions_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_wallet_transactions_updated_at ON wallet_transactions;

CREATE TRIGGER trg_wallet_transactions_updated_at
  BEFORE UPDATE ON wallet_transactions
  FOR EACH ROW
  EXECUTE FUNCTION update_wallet_transactions_updated_at();
