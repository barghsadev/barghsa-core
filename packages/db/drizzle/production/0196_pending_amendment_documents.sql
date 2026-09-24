-- A pending amendment has its own staff-authored document, while the accepted
-- base version remains locked for the duration of review.
CREATE OR REPLACE FUNCTION guard_contract_document_link() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM 1 FROM contracts WHERE id=NEW.contract_id FOR SHARE;
  IF NOT EXISTS (SELECT 1 FROM documents d JOIN contracts c ON c.id=NEW.contract_id
    WHERE d.id=NEW.document_id AND d.business_record_type='contract'
      AND d.business_record_id=c.id AND d.profile_id=c.profile_id
      AND (d.uploaded_by_type<>'customer' OR NEW.role='signed')
      AND ((c.current_version_id=NEW.contract_version_id AND c.signed_at IS NULL
        AND c.state NOT IN ('Signed','Active','Completed','Cancelled'))
        OR (d.uploaded_by_type='staff' AND NEW.role='amendment'
          AND c.state IN ('Accepted','Signed','Active')
          AND EXISTS(SELECT 1 FROM contract_amendments a
            WHERE a.contract_id=c.id AND a.version_id=NEW.contract_version_id
              AND a.base_version_id=c.current_version_id
              AND a.state IN ('Draft','AwaitingCustomerAcceptance'))))) THEN
    RAISE EXCEPTION 'Contract document association must match its business record' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION lock_signed_contract_documents() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF (NEW.state IN ('Signed','Active','Completed') AND OLD.state NOT IN ('Signed','Active','Completed'))
     OR (NEW.signed_at IS NOT NULL AND NEW.signed_at IS DISTINCT FROM OLD.signed_at)
     OR (NEW.current_version_id<>OLD.current_version_id AND NEW.state IN ('Signed','Active','Completed')) THEN
    INSERT INTO contract_document_locks(document_id,contract_version_id)
      SELECT cd.document_id,cd.contract_version_id FROM contract_documents cd
      WHERE cd.contract_id=NEW.id AND cd.contract_version_id=NEW.current_version_id
      ON CONFLICT (document_id) DO NOTHING;
  END IF;
  RETURN NULL;
END $$;
