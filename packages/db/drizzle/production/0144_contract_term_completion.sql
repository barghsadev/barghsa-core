CREATE TABLE "contract_completions" (
	"version_id" uuid PRIMARY KEY NOT NULL,
	"contract_id" uuid NOT NULL,
	"completed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "contract_activation_requirements" ADD COLUMN "service_ends_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "contract_completions" ADD CONSTRAINT "contract_completions_version_fk" FOREIGN KEY ("contract_id","version_id") REFERENCES "public"."contract_versions"("contract_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "contract_completions_contract_idx" ON "contract_completions" USING btree ("contract_id");--> statement-breakpoint
CREATE INDEX "activation_requirements_end_idx" ON "contract_activation_requirements" USING btree ("service_ends_at");--> statement-breakpoint
ALTER TABLE "contract_activation_requirements" ADD CONSTRAINT "activation_requirements_term_order" CHECK ("contract_activation_requirements"."service_ends_at" IS NULL OR "contract_activation_requirements"."service_starts_at" IS NULL OR "contract_activation_requirements"."service_ends_at">"contract_activation_requirements"."service_starts_at");
--> statement-breakpoint
CREATE OR REPLACE FUNCTION guard_contract_activation_requirement() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE parent contracts%ROWTYPE; rule contract_activation_rules%ROWTYPE;
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Activation requirements cannot be deleted' USING ERRCODE='23514'; END IF;
 SELECT * INTO parent FROM contracts WHERE id=NEW.contract_id FOR UPDATE;
 IF NOT FOUND OR NOT EXISTS(SELECT 1 FROM contract_versions WHERE id=NEW.version_id AND contract_id=NEW.contract_id)
 THEN RAISE EXCEPTION 'Activation requirements must belong to their contract version' USING ERRCODE='23514'; END IF;
 IF TG_OP='INSERT' THEN
  SELECT * INTO rule FROM contract_activation_rules WHERE service_type=parent.service_type FOR SHARE;
  IF NOT FOUND OR NEW.rule_revision<>rule.revision OR NEW.signature_required<>rule.signature_required
   OR NEW.payment_required<>rule.payment_required OR NEW.service_start_required<>rule.service_start_required
  THEN RAISE EXCEPTION 'Activation requirements must snapshot current service rules' USING ERRCODE='23514'; END IF;
  NEW.captured_at:=clock_timestamp();
 ELSE
  IF (to_jsonb(NEW)-'initial_invoice_id'-'service_starts_at'-'service_ends_at') IS DISTINCT FROM (to_jsonb(OLD)-'initial_invoice_id'-'service_starts_at'-'service_ends_at')
   OR parent.current_version_id<>NEW.version_id OR parent.state NOT IN ('Draft','ChangesRequested')
   OR EXISTS(SELECT 1 FROM contract_publications WHERE version_id=NEW.version_id)
  THEN RAISE EXCEPTION 'Published activation requirements and rule snapshots are immutable' USING ERRCODE='23514'; END IF;
 END IF;
 IF NEW.initial_invoice_id IS NOT NULL AND NOT EXISTS(
  SELECT 1 FROM invoices i WHERE i.id=NEW.initial_invoice_id AND i.profile_id=parent.profile_id
   AND i.state NOT IN ('Cancelled','Refunded','PartiallyRefunded') AND i.adjustment_for_invoice_id IS NULL
   AND (i.contract_id=parent.id::text OR (parent.order_id IS NOT NULL AND i.order_id=parent.order_id AND (i.contract_id IS NULL OR i.contract_id=parent.id::text))))
 THEN RAISE EXCEPTION 'Initial invoice must belong to the contract profile and order or contract' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION snapshot_contract_activation_requirements() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE parent contracts%ROWTYPE; rule contract_activation_rules%ROWTYPE; previous contract_activation_requirements%ROWTYPE; invoice_id uuid;
BEGIN
 SELECT * INTO parent FROM contracts WHERE id=NEW.contract_id FOR UPDATE;
 SELECT * INTO rule FROM contract_activation_rules WHERE service_type=parent.service_type FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Contract activation rule is missing' USING ERRCODE='23514'; END IF;
 SELECT * INTO previous FROM contract_activation_requirements WHERE version_id=parent.current_version_id;
 SELECT i.id INTO invoice_id FROM invoices i WHERE i.profile_id=parent.profile_id
  AND i.state NOT IN ('Cancelled','Refunded','PartiallyRefunded') AND i.adjustment_for_invoice_id IS NULL
  AND (i.contract_id=parent.id::text OR (parent.order_id IS NOT NULL AND i.order_id=parent.order_id AND (i.contract_id IS NULL OR i.contract_id=parent.id::text)))
  AND (i.id=previous.initial_invoice_id OR (previous.initial_invoice_id IS NULL AND i.type='auto' AND i.replaces_invoice_id IS NULL))
  ORDER BY i.id LIMIT 1;
 INSERT INTO contract_activation_requirements(version_id,contract_id,rule_revision,signature_required,payment_required,service_start_required,initial_invoice_id,service_starts_at,service_ends_at)
  VALUES(NEW.id,NEW.contract_id,rule.revision,rule.signature_required,rule.payment_required,rule.service_start_required,invoice_id,previous.service_starts_at,previous.service_ends_at);
 RETURN NULL;
END $$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION check_contract_version_material_change() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF EXISTS(SELECT 1 FROM contract_versions prior_version JOIN contract_activation_requirements previous ON previous.version_id=prior_version.id
   JOIN contract_activation_requirements current ON current.version_id=NEW.id
   WHERE prior_version.contract_id=NEW.contract_id AND prior_version.version_number=NEW.version_number-1 AND prior_version.content=NEW.content
    AND ROW(previous.signature_required,previous.payment_required,previous.service_start_required,previous.initial_invoice_id,previous.service_starts_at,previous.service_ends_at)
     IS NOT DISTINCT FROM ROW(current.signature_required,current.payment_required,current.service_start_required,current.initial_invoice_id,current.service_starts_at,current.service_ends_at))
 THEN RAISE EXCEPTION 'Unchanged terms and activation context cannot create a material version' USING ERRCODE='23514'; END IF;
 RETURN NULL;
END $$;
--> statement-breakpoint
CREATE FUNCTION guard_contract_completion() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE parent contracts%ROWTYPE; ends_at timestamptz;
BEGIN
 IF TG_OP<>'INSERT' THEN RAISE EXCEPTION 'Completion evidence is immutable' USING ERRCODE='23514'; END IF;
 IF EXISTS(SELECT 1 FROM contract_completions WHERE version_id=NEW.version_id AND contract_id=NEW.contract_id) THEN RETURN NEW; END IF;
 SELECT * INTO parent FROM contracts WHERE id=NEW.contract_id FOR UPDATE NOWAIT;
 SELECT service_ends_at INTO ends_at FROM contract_activation_requirements WHERE contract_id=NEW.contract_id AND version_id=NEW.version_id;
 IF parent.id IS NULL OR parent.state<>'Active' OR parent.current_version_id<>NEW.version_id
  OR ends_at IS NULL OR ends_at>clock_timestamp()
 THEN RAISE EXCEPTION 'Contract term is not ready for completion' USING ERRCODE='23514', CONSTRAINT='contract_completion_prerequisites'; END IF;
 NEW.completed_at:=clock_timestamp();
 RETURN NEW;
END $$;
CREATE TRIGGER contract_completions_guard BEFORE INSERT OR UPDATE OR DELETE ON contract_completions
 FOR EACH ROW EXECUTE FUNCTION guard_contract_completion();
--> statement-breakpoint
CREATE FUNCTION apply_contract_completion() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 UPDATE contracts SET state='Completed',completed_at=NEW.completed_at WHERE id=NEW.contract_id;
 INSERT INTO audit_log(id,user_id,event,metadata,correlation_id,ip)
 SELECT gen_random_uuid(),p.user_id,'contract.completed',jsonb_build_object('contractId',NEW.contract_id,'versionId',NEW.version_id,'actorType','system','completedAt',NEW.completed_at,'financialClosure',false),gen_random_uuid(),'127.0.0.1'
 FROM contracts c JOIN profiles p ON p.id=c.profile_id WHERE c.id=NEW.contract_id;
 RETURN NULL;
END $$;
CREATE TRIGGER contract_completions_apply AFTER INSERT ON contract_completions
 FOR EACH ROW EXECUTE FUNCTION apply_contract_completion();
--> statement-breakpoint
CREATE FUNCTION guard_contract_completed_state() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 -- Already completed legacy records stay intact without invented evidence.
 IF TG_OP='UPDATE' AND OLD.state='Completed' AND NEW.state='Completed'
  AND NEW.completed_at IS NOT DISTINCT FROM OLD.completed_at AND NEW.current_version_id=OLD.current_version_id THEN RETURN NEW; END IF;
 IF (NEW.state='Completed' OR NEW.completed_at IS NOT NULL) AND NOT EXISTS(
  SELECT 1 FROM contract_completions c WHERE c.contract_id=NEW.id AND c.version_id=NEW.current_version_id AND c.completed_at=NEW.completed_at)
 THEN RAISE EXCEPTION 'Completed contract requires exact-version end-of-term evidence' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER contracts_completion_state BEFORE INSERT OR UPDATE ON contracts
 FOR EACH ROW EXECUTE FUNCTION guard_contract_completed_state();
