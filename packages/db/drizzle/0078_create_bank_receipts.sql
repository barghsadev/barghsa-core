-- Migration 0078: bank_receipts (T-04.3.01.01 / S-04.3.01)
--
-- Durable invoice bank-receipt evidence. Customers submit a receipt
-- (amount, calendar payment date, payer reference, attachment, optional
-- note). Finance staff later confirms or rejects it. Settlement,
-- overpayment wallet credit, and dual-approval are later tasks.
--
-- invoice_id + profile_id → invoices(id, profile_id) (RESTRICT)
--   so a receipt cannot attach to another profile's invoice.
-- profile_id              → profiles.id (RESTRICT)
-- confirmed_by            → users.user_id (RESTRICT)
--
-- States: Submitted → UnderReview → Confirmed | Rejected
-- Confirm/reject are also allowed from Submitted.
--
-- Guarantees:
--   - amount is a positive int8 IRR value;
--   - state is one of the four lifecycle values (default Submitted);
--   - Confirmed rows set confirmed_by + confirmed_at together and keep
--     rejection_reason NULL;
--   - Rejected rows set a non-blank rejection_reason and keep
--     confirmation columns NULL;
--   - in-flight rows keep confirmation and rejection columns NULL;
--   - one attachment_key backs at most one receipt;
--   - receipt (invoice_id, profile_id) must match invoices(id, profile_id);
--   - lookup indexes on invoice_id, profile_id, and state;
--   - updated_at maintained by trigger.
--
-- Fail closed: missing invoices, profiles, or users aborts the
-- migration so Drizzle never records 0078 as applied. Prior journal
-- entries must establish those tables; isolated migrate() tests seed
-- them before migrate() rather than no-op'ing this file.
-- Idempotent: unique-constraint DO-block + CREATE TABLE IF NOT EXISTS +
-- composite-FK DO-block + IF NOT EXISTS indexes + DROP TRIGGER IF EXISTS.
--
-- Rollback:
--   DROP TABLE IF EXISTS bank_receipts CASCADE;
--   ALTER TABLE invoices DROP CONSTRAINT IF EXISTS uq_invoices_id_profile_id;
--   DROP FUNCTION IF EXISTS update_bank_receipts_updated_at();

-- Composite FK target: invoices(id) is already unique (PK). PostgreSQL
-- still needs a UNIQUE constraint on (id, profile_id) before a child
-- table can REFERENCES that pair.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'uq_invoices_id_profile_id'
      AND conrelid = 'invoices'::regclass
  ) THEN
    ALTER TABLE invoices
      ADD CONSTRAINT uq_invoices_id_profile_id UNIQUE (id, profile_id);
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS bank_receipts (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v7(),
  invoice_id UUID NOT NULL,
  profile_id UUID NOT NULL REFERENCES profiles(id) ON DELETE RESTRICT,
  amount BIGINT NOT NULL
    CONSTRAINT chk_bank_receipts_amount_positive
      CHECK (amount > 0),
  payment_date DATE NOT NULL,
  payer_reference TEXT NOT NULL
    CONSTRAINT chk_bank_receipts_payer_reference_nonblank
      CHECK (length(trim(payer_reference)) > 0),
  attachment_key TEXT NOT NULL
    CONSTRAINT chk_bank_receipts_attachment_key_nonblank
      CHECK (length(trim(attachment_key)) > 0),
  customer_note TEXT,
  state TEXT NOT NULL DEFAULT 'Submitted'
    CONSTRAINT chk_bank_receipts_state
      CHECK (state IN ('Submitted', 'UnderReview', 'Confirmed', 'Rejected')),
  confirmed_by TEXT,
  confirmed_at TIMESTAMPTZ,
  rejection_reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT chk_bank_receipts_state_fields CHECK (
    (
      state = 'Confirmed'
      AND confirmed_by IS NOT NULL
      AND confirmed_at IS NOT NULL
      AND rejection_reason IS NULL
    )
    OR (
      state = 'Rejected'
      AND rejection_reason IS NOT NULL
      AND length(trim(rejection_reason)) > 0
      AND confirmed_by IS NULL
      AND confirmed_at IS NULL
    )
    OR (
      state IN ('Submitted', 'UnderReview')
      AND confirmed_by IS NULL
      AND confirmed_at IS NULL
      AND rejection_reason IS NULL
    )
  ),
  CONSTRAINT fk_bank_receipts_invoice_profile
    FOREIGN KEY (invoice_id, profile_id)
    REFERENCES invoices(id, profile_id) ON DELETE RESTRICT,
  CONSTRAINT fk_bank_receipts_confirmed_by
    FOREIGN KEY (confirmed_by) REFERENCES users(user_id) ON DELETE RESTRICT
);

-- Backfill the composite FK when bank_receipts already existed without it
-- (CREATE TABLE IF NOT EXISTS is a no-op on a prior 0078 shape).
DO $$
BEGIN
  IF to_regclass('bank_receipts') IS NOT NULL
     AND NOT EXISTS (
       SELECT 1 FROM pg_constraint
       WHERE conname = 'fk_bank_receipts_invoice_profile'
         AND conrelid = 'bank_receipts'::regclass
     ) THEN
    ALTER TABLE bank_receipts
      ADD CONSTRAINT fk_bank_receipts_invoice_profile
      FOREIGN KEY (invoice_id, profile_id)
      REFERENCES invoices(id, profile_id) ON DELETE RESTRICT;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_bank_receipts_invoice_id ON bank_receipts (invoice_id);
CREATE INDEX IF NOT EXISTS idx_bank_receipts_profile_id ON bank_receipts (profile_id);
CREATE INDEX IF NOT EXISTS idx_bank_receipts_state ON bank_receipts (state);
CREATE UNIQUE INDEX IF NOT EXISTS uq_bank_receipts_attachment_key
  ON bank_receipts (attachment_key);

CREATE OR REPLACE FUNCTION update_bank_receipts_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_bank_receipts_updated_at ON bank_receipts;

CREATE TRIGGER trg_bank_receipts_updated_at
  BEFORE UPDATE ON bank_receipts
  FOR EACH ROW
  EXECUTE FUNCTION update_bank_receipts_updated_at();
