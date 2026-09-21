CREATE TABLE "contract_activations" (
	"version_id" uuid PRIMARY KEY NOT NULL,
	"contract_id" uuid NOT NULL,
	"activated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "contract_activations" ADD CONSTRAINT "contract_activations_version_fk" FOREIGN KEY ("contract_id","version_id") REFERENCES "public"."contract_versions"("contract_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "contract_activations_contract_idx" ON "contract_activations" USING btree ("contract_id");
--> statement-breakpoint
-- Shared prerequisite resolver used by both the API and activation guard.
CREATE FUNCTION contract_activation_status(p_contract uuid,p_version uuid DEFAULT NULL,p_profile uuid DEFAULT NULL,p_staff boolean DEFAULT true)
RETURNS TABLE(id uuid,version_id uuid,current_version_id uuid,state contract_state,archived boolean,rule_revision integer,
signature_required boolean,payment_required boolean,service_start_required boolean,initial_invoice_id uuid,service_starts_at timestamptz,
approved boolean,accepted boolean,signed boolean,paid boolean,started boolean,evaluated_at timestamptz)
LANGUAGE sql STABLE AS $$
SELECT c.id,v.id AS version_id,c.current_version_id,c.state,p.archived,r.rule_revision,r.signature_required,r.payment_required,r.service_start_required,r.initial_invoice_id,r.service_starts_at,
      EXISTS(SELECT 1 FROM contract_publications WHERE contract_id=c.id AND version_id=v.id) AS approved,
      EXISTS(SELECT 1 FROM contract_acceptances WHERE contract_id=c.id AND version_id=v.id) AS accepted,
      EXISTS(SELECT 1 FROM contract_signatures s JOIN documents d ON d.id=s.signed_document_id WHERE s.contract_id=c.id AND s.version_id=v.id AND d.state='Approved') AS signed,
      EXISTS(SELECT 1 FROM invoices i WHERE i.id=r.initial_invoice_id AND i.profile_id=c.profile_id AND (i.contract_id=c.id::text OR (c.order_id IS NOT NULL AND i.order_id=c.order_id AND (i.contract_id IS NULL OR i.contract_id=c.id::text)))
        AND i.adjustment_for_invoice_id IS NULL AND i.state='Paid' AND i.paid_amount>=i.total_amount AND i.refunded_amount=0) AS paid,
      COALESCE(r.service_starts_at<=statement_timestamp(),false) AS started,statement_timestamp() AS evaluated_at
      FROM contracts c JOIN profiles p ON p.id=c.profile_id JOIN contract_versions v ON v.contract_id=c.id
      JOIN contract_activation_requirements r ON r.version_id=v.id AND r.contract_id=c.id
      WHERE c.id=p_contract AND (p_profile::uuid IS NULL OR c.profile_id=p_profile) AND (p_version::uuid IS NULL OR v.id=p_version)
        AND (p_staff::boolean OR EXISTS(SELECT 1 FROM contract_publications WHERE contract_id=c.id AND version_id=v.id))
      ORDER BY v.version_number DESC LIMIT 1;
$$;
--> statement-breakpoint
CREATE FUNCTION guard_contract_activation() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE identity contracts%ROWTYPE; requirements contract_activation_requirements%ROWTYPE; evidence record;
BEGIN
 IF TG_OP<>'INSERT' THEN RAISE EXCEPTION 'Activation evidence is immutable' USING ERRCODE='23514'; END IF;
 IF EXISTS(SELECT 1 FROM contract_activations WHERE version_id=NEW.version_id AND contract_id=NEW.contract_id) THEN RETURN NEW; END IF;
 SELECT * INTO identity FROM contracts WHERE id=NEW.contract_id;
 IF NOT FOUND THEN RAISE EXCEPTION 'Contract is unavailable' USING ERRCODE='23514'; END IF;
 -- Consistent financial lock order: profile, initial invoice, then contract.
 -- Fail immediately on contention so another poll can retry without deadlocks.
 PERFORM 1 FROM profiles WHERE id=identity.profile_id FOR SHARE NOWAIT;
 SELECT * INTO requirements FROM contract_activation_requirements WHERE version_id=NEW.version_id AND contract_id=NEW.contract_id;
 IF requirements.payment_required AND requirements.initial_invoice_id IS NOT NULL THEN
  PERFORM 1 FROM invoices WHERE id=requirements.initial_invoice_id FOR SHARE NOWAIT;
 END IF;
 PERFORM 1 FROM contracts WHERE id=NEW.contract_id FOR UPDATE NOWAIT;
 SELECT * INTO evidence FROM contract_activation_status(NEW.contract_id,NEW.version_id);
 IF NOT FOUND OR evidence.archived OR evidence.version_id<>evidence.current_version_id
  OR evidence.state NOT IN ('Accepted','Signed') OR NOT evidence.approved OR NOT evidence.accepted
  OR (evidence.signature_required AND NOT evidence.signed)
  OR (evidence.payment_required AND NOT evidence.paid)
  OR (evidence.service_start_required AND NOT evidence.started)
 THEN RAISE EXCEPTION 'Activation prerequisites are not met' USING ERRCODE='23514', CONSTRAINT='contract_activation_prerequisites'; END IF;
 NEW.activated_at:=clock_timestamp();
 RETURN NEW;
END $$;
CREATE TRIGGER contract_activations_guard BEFORE INSERT OR UPDATE OR DELETE ON contract_activations
 FOR EACH ROW EXECUTE FUNCTION guard_contract_activation();
--> statement-breakpoint
CREATE FUNCTION apply_contract_activation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 UPDATE contracts SET state='Active',activated_at=NEW.activated_at WHERE id=NEW.contract_id;
 INSERT INTO audit_log(id,user_id,event,metadata,correlation_id,ip)
 SELECT gen_random_uuid(),p.user_id,'contract.activated',jsonb_build_object('contractId',NEW.contract_id,'versionId',NEW.version_id,'actorType','system','activatedAt',NEW.activated_at),gen_random_uuid(),'127.0.0.1'
 FROM contracts c JOIN profiles p ON p.id=c.profile_id WHERE c.id=NEW.contract_id;
 RETURN NULL;
END $$;
CREATE TRIGGER contract_activations_apply AFTER INSERT ON contract_activations
 FOR EACH ROW EXECUTE FUNCTION apply_contract_activation();
--> statement-breakpoint
CREATE FUNCTION guard_contract_active_state() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='UPDATE' AND OLD.state='Active' AND NEW.state NOT IN ('Active','Completed','Cancelled')
 THEN RAISE EXCEPTION 'Active contracts cannot return to a previous lifecycle stage' USING ERRCODE='23514'; END IF;
 IF TG_OP='UPDATE' AND OLD.activated_at IS NOT NULL
  AND (NEW.activated_at IS DISTINCT FROM OLD.activated_at OR NEW.current_version_id<>OLD.current_version_id)
 THEN RAISE EXCEPTION 'Activation timestamp and version are immutable' USING ERRCODE='23514'; END IF;
 -- Preserve already-active legacy contracts without inventing activation evidence.
 IF TG_OP='UPDATE' AND OLD.state IN ('Active','Completed','Cancelled')
  AND NEW.state IN ('Active','Completed','Cancelled') AND NEW.activated_at IS NOT DISTINCT FROM OLD.activated_at
  AND NEW.current_version_id=OLD.current_version_id THEN RETURN NEW; END IF;
 IF (NEW.state='Active' OR NEW.activated_at IS NOT NULL) AND NOT EXISTS(
  SELECT 1 FROM contract_activations a WHERE a.contract_id=NEW.id AND a.version_id=NEW.current_version_id AND a.activated_at=NEW.activated_at)
 THEN RAISE EXCEPTION 'Active contract requires exact-version system activation evidence' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER contracts_activation_state BEFORE INSERT OR UPDATE ON contracts
 FOR EACH ROW EXECUTE FUNCTION guard_contract_active_state();
