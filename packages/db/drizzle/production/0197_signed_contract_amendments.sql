-- A signature-required amendment is accepted and signed while the prior
-- accepted version remains effective. Only signed-copy evidence applies it.
CREATE OR REPLACE FUNCTION guard_contract_amendment_draft() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE parent contracts%ROWTYPE; publication contract_publications%ROWTYPE;
 acceptance contract_acceptances%ROWTYPE; signature contract_signatures%ROWTYPE; signature_needed boolean;
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Amendment history is immutable' USING ERRCODE='23514'; END IF;
 SELECT * INTO parent FROM contracts WHERE id=NEW.contract_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Amendment requires its contract' USING ERRCODE='23514'; END IF;
 IF TG_OP='INSERT' THEN
  IF parent.state NOT IN ('Accepted','Signed','Active') OR parent.current_version_id<>NEW.base_version_id
   OR NOT EXISTS(SELECT 1 FROM contract_acceptances WHERE contract_id=NEW.contract_id AND version_id=NEW.base_version_id)
   OR NEW.state<>'Draft' OR NEW.published_at IS NOT NULL OR NEW.applied_at IS NOT NULL OR NEW.withdrawn_at IS NOT NULL
  THEN RAISE EXCEPTION 'Amendment draft requires the current accepted version' USING ERRCODE='23514'; END IF;
  RETURN NEW;
 END IF;
 IF (to_jsonb(NEW)-'state'-'published_at'-'applied_at') IS DISTINCT FROM
    (to_jsonb(OLD)-'state'-'published_at'-'applied_at')
 THEN RAISE EXCEPTION 'Amendment identity and history are immutable' USING ERRCODE='23514'; END IF;
 SELECT r.signature_required INTO signature_needed FROM contract_activation_requirements r WHERE r.version_id=NEW.version_id;
 IF OLD.state='Draft' AND NEW.state='AwaitingCustomerAcceptance' THEN
  SELECT * INTO publication FROM contract_publications WHERE contract_id=NEW.contract_id AND version_id=NEW.version_id;
  IF NOT FOUND OR parent.current_version_id<>NEW.base_version_id OR NEW.published_at IS DISTINCT FROM publication.published_at
   OR NEW.applied_at IS NOT NULL
  THEN RAISE EXCEPTION 'Amendment publication evidence is required' USING ERRCODE='23514'; END IF;
 ELSIF OLD.state='AwaitingCustomerAcceptance' AND NEW.state IN ('AwaitingSignature','Applied') THEN
  SELECT * INTO acceptance FROM contract_acceptances WHERE contract_id=NEW.contract_id AND version_id=NEW.version_id;
  IF NOT FOUND OR parent.current_version_id<>NEW.base_version_id OR NEW.published_at IS DISTINCT FROM OLD.published_at
   OR (signature_needed AND (NEW.state<>'AwaitingSignature' OR NEW.applied_at IS NOT NULL))
   OR (NOT signature_needed AND (NEW.state<>'Applied' OR NEW.applied_at IS DISTINCT FROM acceptance.accepted_at))
  THEN RAISE EXCEPTION 'Amendment acceptance evidence is required' USING ERRCODE='23514'; END IF;
 ELSIF OLD.state='AwaitingSignature' AND NEW.state='Applied' THEN
  SELECT * INTO signature FROM contract_signatures WHERE contract_id=NEW.contract_id AND version_id=NEW.version_id;
  IF NOT FOUND OR parent.current_version_id<>NEW.base_version_id OR NOT signature_needed
   OR NEW.published_at IS DISTINCT FROM OLD.published_at OR NEW.applied_at IS DISTINCT FROM signature.recorded_at
  THEN RAISE EXCEPTION 'Amendment signature evidence is required' USING ERRCODE='23514'; END IF;
 ELSE
  RAISE EXCEPTION 'Invalid amendment transition' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION guard_contract_review_evidence() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE parent contracts%ROWTYPE; amendment contract_amendments%ROWTYPE;
BEGIN
 IF TG_OP<>'INSERT' THEN RAISE EXCEPTION 'Contract review evidence is immutable' USING ERRCODE='23514'; END IF;
 SELECT * INTO parent FROM contracts WHERE id=NEW.contract_id FOR UPDATE;
 SELECT * INTO amendment FROM contract_amendments WHERE contract_id=NEW.contract_id AND version_id=NEW.version_id;
 IF FOUND THEN
  IF parent.current_version_id<>amendment.base_version_id OR parent.state NOT IN ('Accepted','Signed','Active')
  THEN RAISE EXCEPTION 'Amendment base version changed' USING ERRCODE='23514'; END IF;
  IF TG_TABLE_NAME='contract_publications' THEN
   IF amendment.state<>'Draft' THEN RAISE EXCEPTION 'Amendment is unavailable for publication' USING ERRCODE='23514'; END IF;
   NEW.published_at:=clock_timestamp();
  ELSE
   IF amendment.state<>'AwaitingCustomerAcceptance'
    OR NOT EXISTS(SELECT 1 FROM contract_publications WHERE version_id=NEW.version_id AND contract_id=NEW.contract_id)
    OR EXISTS(SELECT 1 FROM contract_versions WHERE id=NEW.version_id AND accepted_at IS NOT NULL)
   THEN RAISE EXCEPTION 'Amendment is not awaiting acceptance' USING ERRCODE='23514'; END IF;
   NEW.accepted_at:=clock_timestamp();
  END IF;
  RETURN NEW;
 END IF;
 IF parent.id IS NULL OR parent.current_version_id<>NEW.version_id
 THEN RAISE EXCEPTION 'Review evidence must refer to the current contract version' USING ERRCODE='23514'; END IF;
 IF TG_TABLE_NAME='contract_publications' THEN
  IF parent.state<>'AwaitingStaffReview' THEN RAISE EXCEPTION 'Contract is not awaiting staff review' USING ERRCODE='23514'; END IF;
  NEW.published_at:=clock_timestamp();
 ELSE
  IF parent.state<>'AwaitingCustomerAcceptance' OR NOT EXISTS(SELECT 1 FROM contract_publications WHERE version_id=NEW.version_id)
   OR EXISTS(SELECT 1 FROM contract_versions WHERE id=NEW.version_id AND accepted_at IS NOT NULL)
  THEN RAISE EXCEPTION 'Contract is not awaiting acceptance of this published version' USING ERRCODE='23514'; END IF;
  NEW.accepted_at:=clock_timestamp();
 END IF;
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION apply_contract_review_evidence() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE amendment contract_amendments%ROWTYPE; parent contracts%ROWTYPE; readiness record; signature_needed boolean;
BEGIN
 SELECT * INTO amendment FROM contract_amendments WHERE contract_id=NEW.contract_id AND version_id=NEW.version_id;
 IF FOUND THEN
  IF TG_TABLE_NAME='contract_publications' THEN
   UPDATE contract_amendments SET state='AwaitingCustomerAcceptance',published_at=NEW.published_at WHERE version_id=NEW.version_id;
  ELSE
   SELECT * INTO parent FROM contracts WHERE id=NEW.contract_id FOR UPDATE;
   SELECT signature_required INTO signature_needed FROM contract_activation_requirements WHERE version_id=NEW.version_id;
   UPDATE contract_versions SET accepted_at=NEW.accepted_at WHERE id=NEW.version_id;
   IF signature_needed THEN
    UPDATE contract_amendments SET state='AwaitingSignature' WHERE version_id=NEW.version_id;
   ELSE
    IF parent.state='Active' THEN
     SELECT * INTO readiness FROM contract_activation_status(NEW.contract_id,NEW.version_id);
     IF NOT FOUND OR (readiness.payment_required AND NOT readiness.paid)
      OR (readiness.service_start_required AND NOT readiness.started)
     THEN RAISE EXCEPTION 'Active amendment must meet payment and service-start requirements' USING ERRCODE='23514'; END IF;
    END IF;
    UPDATE contract_amendments SET state='Applied',applied_at=NEW.accepted_at WHERE version_id=NEW.version_id;
    UPDATE contracts SET current_version_id=NEW.version_id,accepted_at=NEW.accepted_at,
     signed_at=NULL,state=CASE WHEN state='Active' THEN 'Active'::contract_state ELSE 'Accepted'::contract_state END
     WHERE id=NEW.contract_id;
   END IF;
  END IF;
  RETURN NULL;
 END IF;
 IF TG_TABLE_NAME='contract_publications' THEN
  UPDATE contracts SET state='AwaitingCustomerAcceptance' WHERE id=NEW.contract_id;
 ELSE
  UPDATE contract_versions SET accepted_at=NEW.accepted_at WHERE id=NEW.version_id;
  UPDATE contracts SET state='Accepted',accepted_at=NEW.accepted_at WHERE id=NEW.contract_id;
 END IF;
 RETURN NULL;
END $$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION guard_contract_signature_request() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE parent contracts%ROWTYPE; previous_number integer; amendment contract_amendments%ROWTYPE; expected_role contract_document_role;
BEGIN
 IF TG_OP<>'INSERT' THEN RAISE EXCEPTION 'Signing requests are immutable' USING ERRCODE='23514'; END IF;
 SELECT * INTO parent FROM contracts WHERE id=NEW.contract_id FOR UPDATE;
 SELECT * INTO amendment FROM contract_amendments WHERE contract_id=NEW.contract_id AND version_id=NEW.version_id;
 IF FOUND THEN
  IF amendment.state<>'AwaitingSignature' OR amendment.base_version_id<>parent.current_version_id
   OR parent.state NOT IN ('Accepted','Signed','Active')
  THEN RAISE EXCEPTION 'Amendment is not awaiting signature' USING ERRCODE='23514'; END IF;
  expected_role:='amendment';
 ELSE
  IF parent.id IS NULL OR parent.current_version_id<>NEW.version_id OR parent.state NOT IN ('Accepted','AwaitingSignature')
   OR parent.signed_at IS NOT NULL
  THEN RAISE EXCEPTION 'Signing request requires the current accepted contract version' USING ERRCODE='23514'; END IF;
  expected_role:='original';
 END IF;
 IF NOT EXISTS(SELECT 1 FROM contract_acceptances WHERE version_id=NEW.version_id AND contract_id=NEW.contract_id)
 THEN RAISE EXCEPTION 'Signing request requires customer acceptance' USING ERRCODE='23514'; END IF;
 PERFORM id FROM documents WHERE id=NEW.original_document_id FOR UPDATE;
 IF NOT EXISTS(SELECT 1 FROM documents d JOIN contract_documents cd ON cd.document_id=d.id
   WHERE d.id=NEW.original_document_id AND d.profile_id=parent.profile_id AND d.state='Approved'
    AND d.storage_key IS NOT NULL AND d.checksum IS NOT NULL AND d.detected_mime='application/pdf'
    AND cd.contract_id=NEW.contract_id AND cd.contract_version_id=NEW.version_id AND cd.role=expected_role)
 THEN RAISE EXCEPTION 'Signing request requires an approved exact-version PDF' USING ERRCODE='23514'; END IF;
 SELECT COALESCE(MAX(request_number),0) INTO previous_number FROM contract_signature_requests WHERE version_id=NEW.version_id;
 IF NEW.request_number<>previous_number+1 THEN RAISE EXCEPTION 'Signing request number must increment exactly once' USING ERRCODE='23514'; END IF;
 NEW.requested_at:=clock_timestamp();
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION apply_contract_signature_request() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM contract_amendments WHERE contract_id=NEW.contract_id AND version_id=NEW.version_id
  AND state='AwaitingSignature') THEN
  UPDATE contracts SET state='AwaitingSignature' WHERE id=NEW.contract_id;
 END IF;
 RETURN NULL;
END $$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION guard_contract_signature() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE parent contracts%ROWTYPE; request contract_signature_requests%ROWTYPE; amendment contract_amendments%ROWTYPE;
BEGIN
 IF TG_OP<>'INSERT' THEN RAISE EXCEPTION 'Signed-copy evidence is immutable' USING ERRCODE='23514'; END IF;
 SELECT * INTO parent FROM contracts WHERE id=NEW.contract_id FOR UPDATE;
 SELECT * INTO amendment FROM contract_amendments WHERE contract_id=NEW.contract_id AND version_id=NEW.version_id;
 IF FOUND THEN
  IF amendment.state<>'AwaitingSignature' OR amendment.base_version_id<>parent.current_version_id
   OR parent.state NOT IN ('Accepted','Signed','Active')
  THEN RAISE EXCEPTION 'Amendment is not awaiting this signature' USING ERRCODE='23514'; END IF;
 ELSE
  IF parent.id IS NULL OR parent.current_version_id<>NEW.version_id OR parent.state<>'AwaitingSignature' OR parent.signed_at IS NOT NULL
  THEN RAISE EXCEPTION 'Signed copy requires the current accepted version awaiting signature' USING ERRCODE='23514'; END IF;
 END IF;
 IF NOT EXISTS(SELECT 1 FROM contract_acceptances WHERE version_id=NEW.version_id AND contract_id=NEW.contract_id)
 THEN RAISE EXCEPTION 'Signed copy requires customer acceptance' USING ERRCODE='23514'; END IF;
 SELECT * INTO request FROM contract_signature_requests WHERE version_id=NEW.version_id ORDER BY request_number DESC LIMIT 1;
 IF NOT FOUND OR request.id<>NEW.request_id OR request.contract_id<>NEW.contract_id
 THEN RAISE EXCEPTION 'Signed copy must use the latest exact-version signing request' USING ERRCODE='23514'; END IF;
 PERFORM id FROM documents WHERE id IN (request.original_document_id,NEW.signed_document_id) ORDER BY id FOR UPDATE;
 IF NOT EXISTS(SELECT 1 FROM documents WHERE id=request.original_document_id AND state='Approved')
 THEN RAISE EXCEPTION 'Requested original is no longer approved' USING ERRCODE='23514'; END IF;
 IF NOT EXISTS(SELECT 1 FROM documents d JOIN contract_documents cd ON cd.document_id=d.id
   WHERE d.id=NEW.signed_document_id AND d.profile_id=parent.profile_id AND d.state='Approved'
     AND d.storage_key IS NOT NULL AND d.checksum IS NOT NULL
     AND cd.contract_id=NEW.contract_id AND cd.contract_version_id=NEW.version_id AND cd.role='signed')
 THEN RAISE EXCEPTION 'Signed copy requires an approved verified document for the exact version and role' USING ERRCODE='23514'; END IF;
 NEW.recorded_at:=clock_timestamp();
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION apply_contract_signature() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE amendment contract_amendments%ROWTYPE; parent contracts%ROWTYPE; readiness record; amendment_accepted_at timestamptz;
BEGIN
 SELECT * INTO amendment FROM contract_amendments WHERE contract_id=NEW.contract_id AND version_id=NEW.version_id;
 IF FOUND THEN
  SELECT * INTO parent FROM contracts WHERE id=NEW.contract_id FOR UPDATE;
  IF parent.state='Active' THEN
   SELECT * INTO readiness FROM contract_activation_status(NEW.contract_id,NEW.version_id);
   IF NOT FOUND OR (readiness.payment_required AND NOT readiness.paid)
    OR (readiness.service_start_required AND NOT readiness.started)
   THEN RAISE EXCEPTION 'Active amendment must meet payment and service-start requirements' USING ERRCODE='23514'; END IF;
  END IF;
  SELECT a.accepted_at INTO amendment_accepted_at FROM contract_acceptances a WHERE a.version_id=NEW.version_id;
  UPDATE contract_amendments SET state='Applied',applied_at=NEW.recorded_at WHERE version_id=NEW.version_id;
  UPDATE contracts SET current_version_id=NEW.version_id,accepted_at=amendment_accepted_at,signed_at=NEW.recorded_at,
   state=CASE WHEN state='Active' THEN 'Active'::contract_state ELSE 'Signed'::contract_state END
   WHERE id=NEW.contract_id;
 ELSE
  UPDATE contracts SET state='Signed',signed_at=NEW.recorded_at WHERE id=NEW.contract_id;
 END IF;
 RETURN NULL;
END $$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION guard_contract_signature_timestamp() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF OLD.signed_at IS NOT NULL AND NEW.signed_at IS DISTINCT FROM OLD.signed_at
  AND NOT (NEW.current_version_id<>OLD.current_version_id AND
   (NEW.signed_at IS NULL OR EXISTS(SELECT 1 FROM contract_amendments a JOIN contract_signatures s
     ON s.contract_id=a.contract_id AND s.version_id=a.version_id
     WHERE a.contract_id=NEW.id AND a.version_id=NEW.current_version_id AND a.base_version_id=OLD.current_version_id
       AND a.state='Applied' AND s.recorded_at=NEW.signed_at)))
 THEN RAISE EXCEPTION 'Signature time is immutable within its contract version' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
--> statement-breakpoint
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
        AND ((a.state IN ('Draft','AwaitingCustomerAcceptance') AND d.uploaded_by_type='staff' AND NEW.role='amendment')
         OR (a.state='AwaitingSignature' AND NEW.role='signed')))))) THEN
  RAISE EXCEPTION 'Contract document association must match its business record' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END $$;
