-- A published amendment is reviewed and accepted independently of its effective base.
CREATE OR REPLACE FUNCTION guard_contract_amendment_draft() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE parent contracts%ROWTYPE; publication contract_publications%ROWTYPE; acceptance contract_acceptances%ROWTYPE;
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
 IF OLD.state='Draft' AND NEW.state='AwaitingCustomerAcceptance' THEN
  SELECT * INTO publication FROM contract_publications WHERE contract_id=NEW.contract_id AND version_id=NEW.version_id;
  IF NOT FOUND OR parent.current_version_id<>NEW.base_version_id OR NEW.published_at IS DISTINCT FROM publication.published_at
   OR NEW.applied_at IS NOT NULL
  THEN RAISE EXCEPTION 'Amendment publication evidence is required' USING ERRCODE='23514'; END IF;
 ELSIF OLD.state='AwaitingCustomerAcceptance' AND NEW.state='Applied' THEN
  SELECT * INTO acceptance FROM contract_acceptances WHERE contract_id=NEW.contract_id AND version_id=NEW.version_id;
  IF NOT FOUND OR parent.current_version_id<>NEW.base_version_id OR NEW.published_at IS DISTINCT FROM OLD.published_at
   OR NEW.applied_at IS DISTINCT FROM acceptance.accepted_at
  THEN RAISE EXCEPTION 'Amendment acceptance evidence is required' USING ERRCODE='23514'; END IF;
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
   IF amendment.state<>'Draft' OR EXISTS(SELECT 1 FROM contract_activation_requirements r WHERE r.version_id=NEW.version_id AND r.signature_required)
   THEN RAISE EXCEPTION 'Amendment is unavailable for publication' USING ERRCODE='23514'; END IF;
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
   NEW.published_at := clock_timestamp();
 ELSE
   IF parent.state<>'AwaitingCustomerAcceptance' OR NOT EXISTS(SELECT 1 FROM contract_publications WHERE version_id=NEW.version_id)
      OR EXISTS(SELECT 1 FROM contract_versions WHERE id=NEW.version_id AND accepted_at IS NOT NULL)
   THEN RAISE EXCEPTION 'Contract is not awaiting acceptance of this published version' USING ERRCODE='23514'; END IF;
   NEW.accepted_at := clock_timestamp();
 END IF;
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION apply_contract_review_evidence() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE amendment contract_amendments%ROWTYPE; parent contracts%ROWTYPE; readiness record;
BEGIN
 SELECT * INTO amendment FROM contract_amendments WHERE contract_id=NEW.contract_id AND version_id=NEW.version_id;
 IF FOUND THEN
  IF TG_TABLE_NAME='contract_publications' THEN
   UPDATE contract_amendments SET state='AwaitingCustomerAcceptance',published_at=NEW.published_at WHERE version_id=NEW.version_id;
  ELSE
   SELECT * INTO parent FROM contracts WHERE id=NEW.contract_id FOR UPDATE;
   IF parent.state='Active' THEN
    SELECT * INTO readiness FROM contract_activation_status(NEW.contract_id,NEW.version_id);
    IF NOT FOUND OR (readiness.payment_required AND NOT readiness.paid)
     OR (readiness.service_start_required AND NOT readiness.started)
    THEN RAISE EXCEPTION 'Active amendment must meet payment and service-start requirements' USING ERRCODE='23514'; END IF;
   END IF;
   UPDATE contract_versions SET accepted_at=NEW.accepted_at WHERE id=NEW.version_id;
   UPDATE contract_amendments SET state='Applied',applied_at=NEW.accepted_at WHERE version_id=NEW.version_id;
   UPDATE contracts SET current_version_id=NEW.version_id,accepted_at=NEW.accepted_at,
    signed_at=NULL,state=CASE WHEN state='Active' THEN 'Active'::contract_state ELSE 'Accepted'::contract_state END
    WHERE id=NEW.contract_id;
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
CREATE OR REPLACE FUNCTION guard_contract_active_state() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE amendment_switch boolean := false;
BEGIN
 IF TG_OP='UPDATE' AND OLD.state='Active' AND NEW.state NOT IN ('Active','Completed','Cancelled')
 THEN RAISE EXCEPTION 'Active contracts cannot return to a previous lifecycle stage' USING ERRCODE='23514'; END IF;
 IF TG_OP='UPDATE' AND NEW.current_version_id<>OLD.current_version_id THEN
  SELECT EXISTS(SELECT 1 FROM contract_amendments a JOIN contract_acceptances e ON e.version_id=a.version_id AND e.contract_id=a.contract_id
   WHERE a.contract_id=NEW.id AND a.version_id=NEW.current_version_id AND a.base_version_id=OLD.current_version_id
    AND a.state='Applied' AND a.applied_at=e.accepted_at AND NEW.accepted_at=e.accepted_at)
  INTO amendment_switch;
 END IF;
 IF TG_OP='UPDATE' AND OLD.activated_at IS NOT NULL
  AND (NEW.activated_at IS DISTINCT FROM OLD.activated_at OR (NEW.current_version_id<>OLD.current_version_id AND NOT amendment_switch))
 THEN RAISE EXCEPTION 'Activation timestamp and version are immutable' USING ERRCODE='23514'; END IF;
 IF TG_OP='UPDATE' AND OLD.state IN ('Active','Completed','Cancelled')
  AND NEW.state IN ('Active','Completed','Cancelled') AND NEW.activated_at IS NOT DISTINCT FROM OLD.activated_at
  AND (NEW.current_version_id=OLD.current_version_id OR (OLD.state='Active' AND NEW.state='Active' AND amendment_switch))
 THEN RETURN NEW; END IF;
 IF (NEW.state='Active' OR NEW.activated_at IS NOT NULL) AND NOT EXISTS(
  SELECT 1 FROM contract_activations a WHERE a.contract_id=NEW.id AND a.version_id=NEW.current_version_id AND a.activated_at=NEW.activated_at)
 THEN RAISE EXCEPTION 'Active contract requires exact-version system activation evidence' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
