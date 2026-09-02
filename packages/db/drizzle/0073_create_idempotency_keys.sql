-- Migration 0073: idempotency_keys unique (idempotency_key, entity_type)
-- (T-04.2.03.03 / C-04.CC.01)
--
-- Guarantee: retrying a money-moving command with the same
-- (idempotencyKey, entityType) returns the original cached JSON
-- response and never posts a second side effect. S-04.2.03 requires
-- payInvoiceWithWallet to be idempotent; this table is the dedicated
-- cache + unique index for that (and later C-04.CC.01 callers).
--
--   * idempotency_key + entity_type — UNIQUE. The same client key may
--     be reused for a different entity type; it may not run twice for
--     the same type.
--   * entity_id — the domain row the first attempt targeted (invoice
--     id for wallet payments).
--   * response — JSONB snapshot of the successful result. NULL means
--     the first attempt is still in flight inside an open transaction.
--   * expires_at — TTL hint for later cleanup of stale in-flight rows
--     (default 24h at write time). Successful responses are kept so a
--     retry after TTL still cannot debit twice.
--
-- Idempotent: CREATE TABLE IF NOT EXISTS + CREATE UNIQUE INDEX IF NOT
-- EXISTS make re-runs a no-op.
--
-- Rollback:
--   DROP TABLE IF EXISTS idempotency_keys CASCADE;

CREATE TABLE IF NOT EXISTS idempotency_keys (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v7(),
  idempotency_key TEXT NOT NULL
    CONSTRAINT chk_idempotency_keys_key_nonblank
      CHECK (char_length(btrim(idempotency_key)) > 0),
  entity_type TEXT NOT NULL
    CONSTRAINT chk_idempotency_keys_entity_type_nonblank
      CHECK (char_length(btrim(entity_type)) > 0),
  entity_id TEXT,
  response JSONB,
  expires_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_idempotency_keys_key_entity_type
  ON idempotency_keys (idempotency_key, entity_type);

CREATE INDEX IF NOT EXISTS idx_idempotency_keys_expires_at
  ON idempotency_keys (expires_at)
  WHERE expires_at IS NOT NULL;

CREATE OR REPLACE FUNCTION update_idempotency_keys_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_idempotency_keys_updated_at ON idempotency_keys;

CREATE TRIGGER trg_idempotency_keys_updated_at
  BEFORE UPDATE ON idempotency_keys
  FOR EACH ROW
  EXECUTE FUNCTION update_idempotency_keys_updated_at();
