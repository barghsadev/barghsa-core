-- Expand/migrate: preserve values from the baseline's ordinary column and
-- restore the generated signed amount expected by adjustment writers/readers.
DO $$
DECLARE generated_kind "char";
BEGIN
  SELECT attgenerated INTO generated_kind FROM pg_attribute
    WHERE attrelid = 'invoices'::regclass AND attname = 'accounting_amount'
      AND NOT attisdropped;
  IF generated_kind = '' THEN
    -- RENAME fails if this backup already exists: never overwrite old evidence.
    ALTER TABLE invoices RENAME COLUMN accounting_amount TO accounting_amount_legacy;
    ALTER TABLE invoices ADD COLUMN accounting_amount BIGINT GENERATED ALWAYS AS (
      CASE WHEN adjustment_kind = 'credit' THEN -total_amount ELSE total_amount END
    ) STORED;
  ELSIF generated_kind = 's' THEN
    ALTER TABLE invoices ADD COLUMN IF NOT EXISTS accounting_amount_legacy BIGINT;
  ELSE
    RAISE EXCEPTION 'Expected ordinary or stored generated invoices.accounting_amount';
  END IF;
END $$;
