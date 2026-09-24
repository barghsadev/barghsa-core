CREATE TYPE "public"."contract_amendment_state" AS ENUM('Draft', 'AwaitingCustomerAcceptance', 'AwaitingSignature', 'Applied', 'Withdrawn');--> statement-breakpoint
CREATE TABLE "contract_amendments" (
	"version_id" uuid PRIMARY KEY NOT NULL,
	"contract_id" uuid NOT NULL,
	"base_version_id" uuid NOT NULL,
	"state" "contract_amendment_state" DEFAULT 'Draft' NOT NULL,
	"proposed_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"published_at" timestamp with time zone,
	"applied_at" timestamp with time zone,
	"withdrawn_at" timestamp with time zone,
	CONSTRAINT "contract_amendments_distinct_versions" CHECK ("contract_amendments"."version_id" <> "contract_amendments"."base_version_id")
);
--> statement-breakpoint
ALTER TABLE "contract_amendments" ADD CONSTRAINT "contract_amendments_contract_id_contracts_id_fk" FOREIGN KEY ("contract_id") REFERENCES "public"."contracts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contract_amendments" ADD CONSTRAINT "contract_amendments_base_version_id_contract_versions_id_fk" FOREIGN KEY ("base_version_id") REFERENCES "public"."contract_versions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contract_amendments" ADD CONSTRAINT "contract_amendments_proposed_by_users_user_id_fk" FOREIGN KEY ("proposed_by") REFERENCES "public"."users"("user_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "contract_amendments_one_pending" ON "contract_amendments" USING btree ("contract_id") WHERE "contract_amendments"."state" IN ('Draft','AwaitingCustomerAcceptance','AwaitingSignature');--> statement-breakpoint
CREATE INDEX "contract_amendments_contract_created_idx" ON "contract_amendments" USING btree ("contract_id","created_at");--> statement-breakpoint
ALTER TABLE "contract_amendments" ADD CONSTRAINT "contract_amendments_base_version_fk"
 FOREIGN KEY ("contract_id","base_version_id") REFERENCES "public"."contract_versions"("contract_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
-- The draft identity is reserved before the immutable version is inserted in the same transaction.
ALTER TABLE "contract_amendments" ADD CONSTRAINT "contract_amendments_version_fk"
 FOREIGN KEY ("contract_id","version_id") REFERENCES "public"."contract_versions"("contract_id","id")
 ON DELETE restrict ON UPDATE no action DEFERRABLE INITIALLY DEFERRED;--> statement-breakpoint
CREATE FUNCTION guard_contract_amendment_draft() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE parent contracts%ROWTYPE;
BEGIN
 IF TG_OP<>'INSERT' THEN RAISE EXCEPTION 'Amendment drafts cannot be changed without review evidence' USING ERRCODE='23514'; END IF;
 SELECT * INTO parent FROM contracts WHERE id=NEW.contract_id FOR UPDATE;
 IF NOT FOUND OR parent.state NOT IN ('Accepted','Signed','Active')
   OR parent.current_version_id<>NEW.base_version_id
   OR NOT EXISTS(SELECT 1 FROM contract_acceptances WHERE contract_id=NEW.contract_id AND version_id=NEW.base_version_id)
   OR NEW.state<>'Draft' OR NEW.published_at IS NOT NULL OR NEW.applied_at IS NOT NULL OR NEW.withdrawn_at IS NOT NULL
 THEN RAISE EXCEPTION 'Amendment draft requires the current accepted version' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;--> statement-breakpoint
CREATE TRIGGER contract_amendments_draft_guard BEFORE INSERT OR UPDATE OR DELETE ON contract_amendments
 FOR EACH ROW EXECUTE FUNCTION guard_contract_amendment_draft();--> statement-breakpoint
CREATE OR REPLACE FUNCTION guard_contract_version() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE parent contracts%ROWTYPE; previous contract_versions%ROWTYPE;
BEGIN
 IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'Contract version history cannot be deleted' USING ERRCODE='23514'; END IF;
 IF TG_OP = 'UPDATE' THEN
   IF (to_jsonb(NEW)-'accepted_at') IS DISTINCT FROM (to_jsonb(OLD)-'accepted_at')
      OR (OLD.accepted_at IS NOT NULL AND NEW.accepted_at IS DISTINCT FROM OLD.accepted_at)
   THEN RAISE EXCEPTION 'Contract versions are immutable' USING ERRCODE='23514'; END IF;
   RETURN NEW;
 END IF;
 SELECT * INTO parent FROM contracts WHERE id=NEW.contract_id FOR UPDATE;
 IF NOT FOUND OR (parent.state NOT IN ('Draft','ChangesRequested') AND NOT
   (parent.state IN ('Accepted','Signed','Active') AND EXISTS(
   SELECT 1 FROM contract_amendments a WHERE a.contract_id=NEW.contract_id AND a.version_id=NEW.id
     AND a.base_version_id=parent.current_version_id AND a.state='Draft')))
 THEN RAISE EXCEPTION 'Contract does not permit a draft version' USING ERRCODE='23514'; END IF;
 SELECT * INTO previous FROM contract_versions WHERE contract_id=NEW.contract_id ORDER BY version_number DESC LIMIT 1;
 IF NEW.version_number<>COALESCE(previous.version_number,0)+1 OR NEW.accepted_at IS NOT NULL
 THEN RAISE EXCEPTION 'Contract version must increment exactly once and start unaccepted' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;--> statement-breakpoint
CREATE OR REPLACE FUNCTION check_current_contract_version() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE target uuid; actual uuid; latest uuid;
BEGIN
 IF TG_TABLE_NAME='contracts' THEN target := NEW.id; ELSE target := NEW.contract_id; END IF;
 SELECT current_version_id INTO actual FROM contracts WHERE id=target;
 SELECT id INTO latest FROM contract_versions WHERE contract_id=target ORDER BY version_number DESC LIMIT 1;
 IF latest IS NULL OR (actual IS DISTINCT FROM latest AND NOT EXISTS(
   SELECT 1 FROM contract_amendments a WHERE a.contract_id=target AND a.version_id=latest
     AND a.base_version_id=actual AND a.state IN ('Draft','AwaitingCustomerAcceptance','AwaitingSignature')))
 THEN RAISE EXCEPTION 'Contract must point to its newest effective or pending amendment version' USING ERRCODE='23514'; END IF;
 RETURN NULL;
END $$;
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
   OR (NOT (parent.current_version_id=NEW.version_id AND
       (parent.state IN ('Draft','ChangesRequested') OR (parent.state='AwaitingStaffReview' AND parent.service_type='electricity')))
      AND NOT EXISTS(SELECT 1 FROM contract_amendments a WHERE a.contract_id=NEW.contract_id
       AND a.version_id=NEW.version_id AND a.base_version_id=parent.current_version_id AND a.state='Draft'))
   OR EXISTS(SELECT 1 FROM contract_publications WHERE version_id=NEW.version_id)
  THEN RAISE EXCEPTION 'Published activation requirements and rule snapshots are immutable' USING ERRCODE='23514'; END IF;
 END IF;
 IF NEW.initial_invoice_id IS NOT NULL AND NOT EXISTS(
  SELECT 1 FROM invoices i WHERE i.id=NEW.initial_invoice_id AND i.profile_id=parent.profile_id
   AND i.state NOT IN ('Cancelled','Refunded','PartiallyRefunded') AND i.adjustment_for_invoice_id IS NULL
   AND (i.contract_id=parent.id::text OR (parent.order_id IS NOT NULL AND i.order_id=parent.order_id AND (i.contract_id IS NULL OR i.contract_id=parent.id::text)))
 ) THEN RAISE EXCEPTION 'Initial invoice must belong to the contract profile and order or contract' USING ERRCODE='23514'; END IF;
 IF TG_OP='UPDATE' AND parent.service_type='electricity' AND parent.state='AwaitingStaffReview'
  AND NOT EXISTS(
   SELECT 1 FROM electricity_orders e JOIN invoices i ON i.order_id=e.id
   WHERE e.id=parent.order_id AND i.id=NEW.initial_invoice_id
    AND i.profile_id=parent.profile_id AND i.adjustment_for_invoice_id IS NULL
    AND ((i.type='auto' AND i.replaces_invoice_id IS NULL)
      OR (i.type='manual' AND i.replaces_invoice_id=OLD.initial_invoice_id))
    AND NEW.service_starts_at IS NOT DISTINCT FROM e.period_start
    AND NEW.service_ends_at IS NOT DISTINCT FROM e.period_end
  )
 THEN RAISE EXCEPTION 'Electricity activation must bind the submitted invoice and term' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
