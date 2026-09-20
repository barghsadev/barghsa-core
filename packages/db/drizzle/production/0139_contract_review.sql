CREATE TABLE "contract_acceptances" (
	"version_id" uuid PRIMARY KEY NOT NULL,
	"contract_id" uuid NOT NULL,
	"accepted_by" text NOT NULL,
	"accepted_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "contract_publications" (
	"version_id" uuid PRIMARY KEY NOT NULL,
	"contract_id" uuid NOT NULL,
	"published_by" text NOT NULL,
	"published_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "contract_acceptances" ADD CONSTRAINT "contract_acceptances_accepted_by_users_user_id_fk" FOREIGN KEY ("accepted_by") REFERENCES "public"."users"("user_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contract_acceptances" ADD CONSTRAINT "contract_acceptances_version_fk" FOREIGN KEY ("contract_id","version_id") REFERENCES "public"."contract_versions"("contract_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contract_publications" ADD CONSTRAINT "contract_publications_published_by_users_user_id_fk" FOREIGN KEY ("published_by") REFERENCES "public"."users"("user_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contract_publications" ADD CONSTRAINT "contract_publications_version_fk" FOREIGN KEY ("contract_id","version_id") REFERENCES "public"."contract_versions"("contract_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "contract_acceptances_contract_idx" ON "contract_acceptances" USING btree ("contract_id");--> statement-breakpoint
CREATE INDEX "contract_publications_contract_idx" ON "contract_publications" USING btree ("contract_id");
--> statement-breakpoint
CREATE FUNCTION guard_contract_review_evidence() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE parent contracts%ROWTYPE;
BEGIN
 IF TG_OP<>'INSERT' THEN RAISE EXCEPTION 'Contract review evidence is immutable' USING ERRCODE='23514'; END IF;
 SELECT * INTO parent FROM contracts WHERE id=NEW.contract_id FOR UPDATE;
 IF NOT FOUND OR parent.current_version_id<>NEW.version_id
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
CREATE TRIGGER contract_publications_guard BEFORE INSERT OR UPDATE OR DELETE ON contract_publications
 FOR EACH ROW EXECUTE FUNCTION guard_contract_review_evidence();
--> statement-breakpoint
CREATE TRIGGER contract_acceptances_guard BEFORE INSERT OR UPDATE OR DELETE ON contract_acceptances
 FOR EACH ROW EXECUTE FUNCTION guard_contract_review_evidence();
--> statement-breakpoint
CREATE FUNCTION apply_contract_review_evidence() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_TABLE_NAME='contract_publications' THEN
   UPDATE contracts SET state='AwaitingCustomerAcceptance' WHERE id=NEW.contract_id;
 ELSE
   UPDATE contract_versions SET accepted_at=NEW.accepted_at WHERE id=NEW.version_id;
   UPDATE contracts SET state='Accepted',accepted_at=NEW.accepted_at WHERE id=NEW.contract_id;
 END IF;
 RETURN NULL;
END $$;
--> statement-breakpoint
CREATE TRIGGER contract_publications_apply AFTER INSERT ON contract_publications
 FOR EACH ROW EXECUTE FUNCTION apply_contract_review_evidence();
--> statement-breakpoint
CREATE TRIGGER contract_acceptances_apply AFTER INSERT ON contract_acceptances
 FOR EACH ROW EXECUTE FUNCTION apply_contract_review_evidence();
--> statement-breakpoint
CREATE FUNCTION require_contract_acceptance_evidence() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.accepted_at IS DISTINCT FROM OLD.accepted_at AND NOT EXISTS(
   SELECT 1 FROM contract_acceptances WHERE version_id=NEW.id AND accepted_at=NEW.accepted_at)
 THEN RAISE EXCEPTION 'Acceptance timestamp requires immutable customer evidence' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER contract_versions_acceptance_evidence BEFORE UPDATE OF accepted_at ON contract_versions
 FOR EACH ROW EXECUTE FUNCTION require_contract_acceptance_evidence();
--> statement-breakpoint
CREATE FUNCTION check_contract_review_state() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE current contracts%ROWTYPE;
BEGIN
 SELECT * INTO current FROM contracts WHERE id=NEW.id;
 IF current.state='AwaitingCustomerAcceptance' AND NOT EXISTS(
   SELECT 1 FROM contract_publications WHERE version_id=current.current_version_id AND contract_id=current.id)
 THEN RAISE EXCEPTION 'Customer review requires publication' USING ERRCODE='23514'; END IF;
 IF current.state='Accepted' AND NOT EXISTS(
   SELECT 1 FROM contract_acceptances WHERE version_id=current.current_version_id AND contract_id=current.id
     AND accepted_at=current.accepted_at)
 THEN RAISE EXCEPTION 'Accepted contract requires version-bound customer evidence' USING ERRCODE='23514'; END IF;
 RETURN NULL;
END $$;
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER contracts_review_evidence AFTER INSERT OR UPDATE ON contracts
 DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION check_contract_review_state();
