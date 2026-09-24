CREATE OR REPLACE FUNCTION guard_contract_document_link() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 PERFORM 1 FROM contracts WHERE id=NEW.contract_id FOR SHARE;
 IF NOT EXISTS (SELECT 1 FROM documents d JOIN contracts c ON c.id=NEW.contract_id
  WHERE d.id=NEW.document_id AND d.business_record_type='contract'
   AND d.business_record_id=c.id AND d.profile_id=c.profile_id
   AND (d.uploaded_by_type<>'customer' OR NEW.role='signed')
   AND ((c.current_version_id=NEW.contract_version_id AND c.signed_at IS NULL
     AND c.state NOT IN ('Signed','Active','Completed','Cancelled'))
     OR (c.state IN ('Accepted','Signed','Active') AND EXISTS(SELECT 1 FROM contract_amendments a
       WHERE a.contract_id=c.id AND a.version_id=NEW.contract_version_id
        AND a.base_version_id=c.current_version_id
        AND ((a.state IN ('Draft','AwaitingCustomerAcceptance','AwaitingSignature')
          AND d.uploaded_by_type='staff' AND NEW.role='amendment')
         OR (a.state='AwaitingSignature' AND NEW.role='signed')))))) THEN
  RAISE EXCEPTION 'Contract document association must match its business record' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END $$;
