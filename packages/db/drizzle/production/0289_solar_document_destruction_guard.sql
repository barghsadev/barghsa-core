-- The destruction worker locks this request row before starting a manifest.
-- A contract association would make every document on the request permanent.
CREATE FUNCTION guard_solar_contract_after_document_destruction() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM documents d JOIN document_destruction_items i ON i.document_id=d.id
    WHERE d.business_record_type='solar_request' AND d.business_record_id=OLD.id
      AND i.status IN ('destroying','destroyed')
  ) THEN
    RAISE EXCEPTION 'Solar contract cannot be linked after document destruction starts'
      USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER solar_contract_document_destruction_guard
  BEFORE UPDATE OF contract_id ON solar_construction_requests
  FOR EACH ROW
  WHEN (NEW.contract_id IS NOT NULL AND NEW.contract_id IS DISTINCT FROM OLD.contract_id)
  EXECUTE FUNCTION guard_solar_contract_after_document_destruction();
