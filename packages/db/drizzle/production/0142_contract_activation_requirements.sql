CREATE TABLE "contract_activation_requirements" (
	"version_id" uuid PRIMARY KEY NOT NULL,
	"contract_id" uuid NOT NULL,
	"rule_revision" integer NOT NULL,
	"signature_required" boolean NOT NULL,
	"payment_required" boolean NOT NULL,
	"service_start_required" boolean NOT NULL,
	"initial_invoice_id" uuid,
	"service_starts_at" timestamp with time zone,
	"captured_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "activation_requirements_revision_positive" CHECK ("contract_activation_requirements"."rule_revision">0)
);
--> statement-breakpoint
CREATE TABLE "contract_activation_rules" (
	"service_type" "contract_service_type" PRIMARY KEY NOT NULL,
	"signature_required" boolean NOT NULL,
	"payment_required" boolean NOT NULL,
	"service_start_required" boolean DEFAULT false NOT NULL,
	"revision" integer DEFAULT 1 NOT NULL,
	"updated_by" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "activation_rules_revision_positive" CHECK ("contract_activation_rules"."revision">0),
	CONSTRAINT "activation_rules_solar_signature" CHECK ("contract_activation_rules"."service_type"<>'solar' OR "contract_activation_rules"."signature_required"),
	CONSTRAINT "activation_rules_electricity_payment" CHECK ("contract_activation_rules"."service_type"<>'electricity' OR "contract_activation_rules"."payment_required")
);
--> statement-breakpoint
ALTER TABLE "contract_activation_requirements" ADD CONSTRAINT "contract_activation_requirements_initial_invoice_id_invoices_id_fk" FOREIGN KEY ("initial_invoice_id") REFERENCES "public"."invoices"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contract_activation_requirements" ADD CONSTRAINT "activation_requirements_version_fk" FOREIGN KEY ("contract_id","version_id") REFERENCES "public"."contract_versions"("contract_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contract_activation_rules" ADD CONSTRAINT "contract_activation_rules_updated_by_users_user_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("user_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "activation_requirements_contract_idx" ON "contract_activation_requirements" USING btree ("contract_id");--> statement-breakpoint
CREATE INDEX "activation_requirements_invoice_idx" ON "contract_activation_requirements" USING btree ("initial_invoice_id");
--> statement-breakpoint
INSERT INTO contract_activation_rules(service_type,signature_required,payment_required,service_start_required)
 VALUES('electricity',false,true,false),('savings',false,false,false),('solar',true,false,false);
--> statement-breakpoint
-- Expand existing versions with default rules. Missing payment/date evidence stays missing.
INSERT INTO contract_activation_requirements(version_id,contract_id,rule_revision,signature_required,payment_required,service_start_required,initial_invoice_id)
 SELECT v.id,c.id,r.revision,r.signature_required,r.payment_required,r.service_start_required,
  (SELECT i.id FROM invoices i WHERE i.order_id=c.order_id AND i.profile_id=c.profile_id AND i.type='auto'
   AND i.replaces_invoice_id IS NULL AND i.adjustment_for_invoice_id IS NULL AND i.state NOT IN ('Cancelled','Refunded','PartiallyRefunded')
   AND (i.contract_id IS NULL OR i.contract_id=c.id::text) ORDER BY i.id LIMIT 1)
 FROM contract_versions v JOIN contracts c ON c.id=v.contract_id JOIN contract_activation_rules r ON r.service_type=c.service_type;
--> statement-breakpoint
CREATE FUNCTION guard_contract_activation_rule() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Activation rule types cannot be deleted' USING ERRCODE='23514'; END IF;
 IF NEW.service_type<>OLD.service_type OR NEW.revision<>OLD.revision+1
 THEN RAISE EXCEPTION 'Activation rule edits must increment their revision' USING ERRCODE='23514'; END IF;
 NEW.updated_at:=clock_timestamp();
 RETURN NEW;
END $$;
CREATE TRIGGER contract_activation_rule_guard BEFORE UPDATE OR DELETE ON contract_activation_rules
 FOR EACH ROW EXECUTE FUNCTION guard_contract_activation_rule();
--> statement-breakpoint
CREATE FUNCTION guard_contract_activation_requirement() RETURNS trigger LANGUAGE plpgsql AS $$
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
  IF (to_jsonb(NEW)-'initial_invoice_id'-'service_starts_at') IS DISTINCT FROM (to_jsonb(OLD)-'initial_invoice_id'-'service_starts_at')
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
CREATE TRIGGER contract_activation_requirement_guard BEFORE INSERT OR UPDATE OR DELETE ON contract_activation_requirements
 FOR EACH ROW EXECUTE FUNCTION guard_contract_activation_requirement();
--> statement-breakpoint
CREATE FUNCTION snapshot_contract_activation_requirements() RETURNS trigger LANGUAGE plpgsql AS $$
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
 INSERT INTO contract_activation_requirements(version_id,contract_id,rule_revision,signature_required,payment_required,service_start_required,initial_invoice_id,service_starts_at)
  VALUES(NEW.id,NEW.contract_id,rule.revision,rule.signature_required,rule.payment_required,rule.service_start_required,invoice_id,previous.service_starts_at);
 RETURN NULL;
END $$;
CREATE TRIGGER contract_version_activation_snapshot AFTER INSERT ON contract_versions
 FOR EACH ROW EXECUTE FUNCTION snapshot_contract_activation_requirements();

--> statement-breakpoint
CREATE OR REPLACE FUNCTION guard_contract_version() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE parent contracts%ROWTYPE; previous contract_versions%ROWTYPE;
BEGIN
 IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'Contract version history cannot be deleted' USING ERRCODE='23514'; END IF;
 IF TG_OP = 'UPDATE' THEN
   -- Acceptance may be recorded once by the later lifecycle workflow, never rewritten.
   IF (to_jsonb(NEW)-'accepted_at') IS DISTINCT FROM (to_jsonb(OLD)-'accepted_at')
      OR (OLD.accepted_at IS NOT NULL AND NEW.accepted_at IS DISTINCT FROM OLD.accepted_at)
   THEN RAISE EXCEPTION 'Contract versions are immutable' USING ERRCODE='23514'; END IF;
   RETURN NEW;
 END IF;
 SELECT * INTO parent FROM contracts WHERE id=NEW.contract_id FOR UPDATE;
 IF NOT FOUND OR parent.state NOT IN ('Draft','ChangesRequested')
 THEN RAISE EXCEPTION 'Contract does not permit a draft version' USING ERRCODE='23514'; END IF;
 SELECT * INTO previous FROM contract_versions WHERE contract_id=NEW.contract_id ORDER BY version_number DESC LIMIT 1;
 IF NEW.version_number<>COALESCE(previous.version_number,0)+1 OR NEW.accepted_at IS NOT NULL
 THEN RAISE EXCEPTION 'Contract version must increment exactly once and start unaccepted' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;

--> statement-breakpoint
-- Invoice/date requirements are part of the material version. Compare after
-- the new version's complete context has been written in the same transaction.
CREATE FUNCTION check_contract_version_material_change() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF EXISTS(SELECT 1 FROM contract_versions prior_version JOIN contract_activation_requirements previous ON previous.version_id=prior_version.id
   JOIN contract_activation_requirements current ON current.version_id=NEW.id
   WHERE prior_version.contract_id=NEW.contract_id AND prior_version.version_number=NEW.version_number-1 AND prior_version.content=NEW.content
    AND ROW(previous.signature_required,previous.payment_required,previous.service_start_required,previous.initial_invoice_id,previous.service_starts_at)
     IS NOT DISTINCT FROM ROW(current.signature_required,current.payment_required,current.service_start_required,current.initial_invoice_id,current.service_starts_at))
 THEN RAISE EXCEPTION 'Unchanged terms and activation context cannot create a material version' USING ERRCODE='23514'; END IF;
 RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER contract_version_material_change AFTER INSERT ON contract_versions
 DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION check_contract_version_material_change();
