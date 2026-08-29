-- Migration 0056: Invoice origin links (T-04.1.02.05)
--
-- Links an invoice to its originating business object. S-04.1.02 states
-- invoices are generated "from orders/contracts" (and consultation fee
-- offers), so an invoice may originate from exactly one of: an order, a
-- contract, or a consultation.
--
--   * order_id        — existing nullable FK -> orders(id), ON DELETE SET
--                       NULL (created in migration 0052 / earlier schema).
--   * contract_id     — existing nullable reference column (contracts table
--                       TBD; FK deferred until it exists).
--   * consultation_id — NEW nullable reference column added by this
--                       migration (consultations table TBD; FK deferred,
--                       mirroring contract_id).
--
-- contract_id / consultation_id are TEXT (deferred FKs) because their
-- target tables do not exist yet. Each carries the origin reference from
-- day one, and the actual FK constraint is added in the epic that creates
-- the corresponding target table — exactly the established pattern
-- documented on the `contractId` column in schema/invoices.ts.
--
-- Idempotent: ADD COLUMN IF NOT EXISTS + CREATE INDEX IF NOT EXISTS make
-- re-runs a no-op.
--
-- Rollback:
--   ALTER TABLE invoices DROP COLUMN IF EXISTS consultation_id;
--   DROP INDEX IF EXISTS idx_invoices_contract_id;
--   DROP INDEX IF EXISTS idx_invoices_consultation_id;

ALTER TABLE invoices
  ADD COLUMN IF NOT EXISTS consultation_id TEXT;

CREATE INDEX IF NOT EXISTS idx_invoices_contract_id ON invoices (contract_id);
CREATE INDEX IF NOT EXISTS idx_invoices_consultation_id ON invoices (consultation_id);
