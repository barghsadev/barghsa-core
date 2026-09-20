CREATE TYPE "public"."contract_service_type" AS ENUM('electricity', 'savings', 'solar');--> statement-breakpoint
CREATE TYPE "public"."contract_state" AS ENUM('Draft', 'AwaitingStaffReview', 'ChangesRequested', 'AwaitingCustomerAcceptance', 'Accepted', 'AwaitingSignature', 'Signed', 'Active', 'Completed', 'Cancelled');--> statement-breakpoint
CREATE TABLE "contract_versions" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"contract_id" uuid NOT NULL,
	"version_number" integer NOT NULL,
	"content" jsonb NOT NULL,
	"change_description" text NOT NULL,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"accepted_at" timestamp with time zone,
	CONSTRAINT "contract_versions_positive" CHECK ("contract_versions"."version_number" > 0),
	CONSTRAINT "contract_versions_object" CHECK (jsonb_typeof("contract_versions"."content") = 'object' AND "contract_versions"."content" <> '{}'::jsonb),
	CONSTRAINT "contract_versions_description" CHECK (length(trim("contract_versions"."change_description")) BETWEEN 1 AND 1000)
);
--> statement-breakpoint
CREATE TABLE "contracts" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"profile_id" uuid NOT NULL,
	"order_id" uuid,
	"service_type" "contract_service_type" NOT NULL,
	"state" "contract_state" DEFAULT 'Draft' NOT NULL,
	"current_version_id" uuid NOT NULL,
	"submitted_at" timestamp with time zone,
	"accepted_at" timestamp with time zone,
	"signed_at" timestamp with time zone,
	"activated_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"cancelled_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "contract_versions" ADD CONSTRAINT "contract_versions_contract_id_contracts_id_fk" FOREIGN KEY ("contract_id") REFERENCES "public"."contracts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contract_versions" ADD CONSTRAINT "contract_versions_created_by_users_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("user_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contracts" ADD CONSTRAINT "contracts_profile_id_profiles_id_fk" FOREIGN KEY ("profile_id") REFERENCES "public"."profiles"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contracts" ADD CONSTRAINT "contracts_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "contract_versions_number_unique" ON "contract_versions" USING btree ("contract_id","version_number");--> statement-breakpoint
CREATE UNIQUE INDEX "contract_versions_identity_unique" ON "contract_versions" USING btree ("contract_id","id");--> statement-breakpoint
CREATE INDEX "contracts_profile_created_idx" ON "contracts" USING btree ("profile_id","created_at","id");--> statement-breakpoint
CREATE INDEX "contracts_order_idx" ON "contracts" USING btree ("order_id");--> statement-breakpoint
CREATE INDEX "contracts_state_idx" ON "contracts" USING btree ("state");
--> statement-breakpoint
ALTER TABLE contracts ADD CONSTRAINT contracts_current_version_fk
 FOREIGN KEY (id,current_version_id) REFERENCES contract_versions(contract_id,id)
 DEFERRABLE INITIALLY DEFERRED;
--> statement-breakpoint
CREATE FUNCTION guard_contract_record() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE linked orders%ROWTYPE;
BEGIN
 IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'Contract history cannot be deleted' USING ERRCODE='23514'; END IF;
 IF TG_OP = 'UPDATE' THEN
   IF (NEW.id,NEW.profile_id,NEW.order_id,NEW.service_type,NEW.created_at)
      IS DISTINCT FROM (OLD.id,OLD.profile_id,OLD.order_id,OLD.service_type,OLD.created_at)
   THEN RAISE EXCEPTION 'Contract identity is immutable' USING ERRCODE='23514'; END IF;
   IF OLD.state IN ('Completed','Cancelled') AND NEW IS DISTINCT FROM OLD
   THEN RAISE EXCEPTION 'Terminal contracts are immutable' USING ERRCODE='23514'; END IF;
 END IF;
 IF NEW.order_id IS NOT NULL THEN
   SELECT * INTO linked FROM orders WHERE id=NEW.order_id FOR SHARE;
   IF NOT FOUND OR linked.profile_id<>NEW.profile_id OR linked.order_type<>NEW.service_type::text
   THEN RAISE EXCEPTION 'Contract order profile/type mismatch' USING ERRCODE='23514'; END IF;
 END IF;
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER contracts_guard BEFORE INSERT OR UPDATE OR DELETE ON contracts
 FOR EACH ROW EXECUTE FUNCTION guard_contract_record();
--> statement-breakpoint
CREATE TRIGGER contracts_updated_at BEFORE UPDATE ON contracts
 FOR EACH ROW EXECUTE FUNCTION modify_updated_at();
--> statement-breakpoint
CREATE FUNCTION guard_contract_order_identity() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF (NEW.profile_id,NEW.order_type) IS DISTINCT FROM (OLD.profile_id,OLD.order_type)
 AND EXISTS(SELECT 1 FROM contracts WHERE order_id=OLD.id AND
   (profile_id<>NEW.profile_id OR service_type::text<>NEW.order_type))
 THEN RAISE EXCEPTION 'Linked contract order identity is immutable' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER contracts_order_identity BEFORE UPDATE ON orders
 FOR EACH ROW EXECUTE FUNCTION guard_contract_order_identity();
--> statement-breakpoint
CREATE FUNCTION guard_contract_version() RETURNS trigger LANGUAGE plpgsql AS $$
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
 IF previous.id IS NOT NULL AND NEW.content=previous.content
 THEN RAISE EXCEPTION 'Unchanged content cannot create a material version' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER contract_versions_guard BEFORE INSERT OR UPDATE OR DELETE ON contract_versions
 FOR EACH ROW EXECUTE FUNCTION guard_contract_version();
--> statement-breakpoint
CREATE FUNCTION check_current_contract_version() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE target uuid; actual uuid; latest uuid;
BEGIN
 IF TG_TABLE_NAME='contracts' THEN target := NEW.id; ELSE target := NEW.contract_id; END IF;
 SELECT current_version_id INTO actual FROM contracts WHERE id=target;
 SELECT id INTO latest FROM contract_versions WHERE contract_id=target ORDER BY version_number DESC LIMIT 1;
 IF latest IS NULL OR actual IS DISTINCT FROM latest
 THEN RAISE EXCEPTION 'Contract must point to its newest version' USING ERRCODE='23514'; END IF;
 RETURN NULL;
END $$;
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER contracts_current_version_check AFTER INSERT OR UPDATE ON contracts
 DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION check_current_contract_version();
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER contract_versions_current_check AFTER INSERT ON contract_versions
 DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION check_current_contract_version();
