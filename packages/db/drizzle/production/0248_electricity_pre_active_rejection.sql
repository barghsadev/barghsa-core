-- Expand the specified pre-active electricity rejection policy. Historical
-- publication, acceptance, signature, version and financial evidence stays intact.
CREATE OR REPLACE FUNCTION guard_rejected_electricity_contract() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.state='Rejected' AND (to_jsonb(NEW)-'updated_at') IS DISTINCT FROM (to_jsonb(OLD)-'updated_at') THEN
    RAISE EXCEPTION 'Rejected electricity contracts are terminal' USING ERRCODE='23514';
  END IF;
  IF NEW.state='Rejected' AND OLD.state<>'Rejected' AND NOT (
    (NEW.service_type='electricity'
      AND OLD.state IN ('Draft','AwaitingStaffReview','ChangesRequested','AwaitingCustomerAcceptance','Accepted','AwaitingSignature','Signed')
      AND EXISTS (SELECT 1 FROM electricity_orders e WHERE e.id=NEW.order_id AND e.profile_id=NEW.profile_id
        AND e.status IN ('draft','submitted','awaiting_staff_review','changes_requested','approved')))
    OR (NEW.service_type='savings' AND OLD.state IN ('AwaitingStaffReview','ChangesRequested')
      AND NOT EXISTS(SELECT 1 FROM contract_publications WHERE contract_id=NEW.id))
  ) THEN
    RAISE EXCEPTION 'Contract is unavailable for rejection' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
-- A signed pre-active electricity contract can end rejected while retaining
-- exactly the same immutable signed-copy evidence and legacy evidence boundary.
CREATE OR REPLACE FUNCTION check_contract_signature_state() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE current contracts%ROWTYPE;
BEGIN
 SELECT * INTO current FROM contracts WHERE id=NEW.id;
 IF current.state='AwaitingSignature' AND NOT EXISTS (SELECT 1 FROM contract_signature_requests
   WHERE contract_id=current.id AND version_id=current.current_version_id)
 THEN RAISE EXCEPTION 'Awaiting signature requires an immutable signing request' USING ERRCODE='23514'; END IF;
 IF current.state='Signed' AND current.signed_at IS NULL
 THEN RAISE EXCEPTION 'Signed state requires its evidence timestamp' USING ERRCODE='23514'; END IF;
 -- Existing signed rows predate this evidence table. Keep their timestamp/version
 -- unchanged during normal post-migration updates, without inventing evidence.
 -- The original INSERT or first unsigned-to-signed UPDATE still checks evidence
 -- at commit, so multiple updates cannot manufacture a grandfathered signature.
 IF TG_OP='UPDATE' AND OLD.signed_at IS NOT NULL
   AND current.signed_at=OLD.signed_at AND current.current_version_id=OLD.current_version_id
   AND (current.state IN ('Signed','Active','Completed','Cancelled') OR (current.state='Rejected' AND current.service_type='electricity'))
   AND NOT EXISTS(SELECT 1 FROM contract_signatures WHERE contract_id=current.id AND version_id=current.current_version_id)
 THEN RETURN NULL; END IF;
 IF current.signed_at IS NOT NULL AND ((current.state NOT IN ('Signed','Active','Completed','Cancelled') AND NOT (current.state='Rejected' AND current.service_type='electricity')) OR NOT EXISTS(
   SELECT 1 FROM contract_signatures WHERE contract_id=current.id AND version_id=current.current_version_id AND recorded_at=current.signed_at))
 THEN RAISE EXCEPTION 'Signed contract requires version-bound signed-copy evidence' USING ERRCODE='23514'; END IF;
 RETURN NULL;
END $$;
