CREATE TABLE "solar_construction_progress_events" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"request_id" uuid NOT NULL,
	"contract_id" uuid NOT NULL,
	"stage" text NOT NULL,
	"revision" integer NOT NULL,
	"operation_id" uuid NOT NULL,
	"actor_user_id" text,
	"note" text NOT NULL,
	"review" jsonb NOT NULL,
	"recorded_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
	CONSTRAINT "solar_progress_stage_revision" CHECK (("solar_construction_progress_events"."stage"='in_progress' AND "solar_construction_progress_events"."revision"=1) OR ("solar_construction_progress_events"."stage"='delivered' AND "solar_construction_progress_events"."revision"=2) OR ("solar_construction_progress_events"."stage"='installed' AND "solar_construction_progress_events"."revision"=3)),
	CONSTRAINT "solar_progress_note" CHECK (char_length(btrim("solar_construction_progress_events"."note")) BETWEEN 1 AND 1000 AND "solar_construction_progress_events"."note"=btrim("solar_construction_progress_events"."note")),
	CONSTRAINT "solar_progress_review" CHECK (jsonb_typeof("solar_construction_progress_events"."review")='object' AND octet_length("solar_construction_progress_events"."review"::text)<=32768)
);
--> statement-breakpoint
ALTER TABLE "solar_construction_progress_events" ADD CONSTRAINT "solar_construction_progress_events_request_id_solar_construction_requests_id_fk" FOREIGN KEY ("request_id") REFERENCES "public"."solar_construction_requests"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "solar_construction_progress_events" ADD CONSTRAINT "solar_construction_progress_events_contract_id_contracts_id_fk" FOREIGN KEY ("contract_id") REFERENCES "public"."contracts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "solar_construction_progress_events" ADD CONSTRAINT "solar_construction_progress_events_actor_user_id_users_user_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("user_id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "solar_progress_operation_key" ON "solar_construction_progress_events" USING btree ("operation_id");--> statement-breakpoint
CREATE UNIQUE INDEX "solar_progress_stage_key" ON "solar_construction_progress_events" USING btree ("request_id","stage");--> statement-breakpoint
CREATE UNIQUE INDEX "solar_progress_revision_key" ON "solar_construction_progress_events" USING btree ("request_id","revision");
--> statement-breakpoint
CREATE FUNCTION guard_solar_construction_progress() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  linked contracts%ROWTYPE;
  request solar_construction_requests%ROWTYPE;
  profile profiles%ROWTYPE;
  previous_revision integer;
BEGIN
  -- Match financial lifecycle lock order, then serialize progress for this request.
  SELECT * INTO request FROM solar_construction_requests WHERE id=NEW.request_id;
  SELECT * INTO profile FROM profiles WHERE id=request.profile_id FOR SHARE NOWAIT;
  SELECT * INTO linked FROM contracts WHERE id=NEW.contract_id FOR SHARE NOWAIT;
  SELECT * INTO request FROM solar_construction_requests WHERE id=NEW.request_id FOR UPDATE;
  IF linked.id IS NULL OR request.id IS NULL OR request.contract_id IS DISTINCT FROM linked.id
    OR request.profile_id IS DISTINCT FROM profile.id OR request.status <> 'contract_created' OR linked.profile_id IS DISTINCT FROM request.profile_id
    OR linked.service_type <> 'solar' OR linked.state NOT IN ('Active','Completed')
    OR profile.archived OR profile.status IN ('DRAFT','SUSPENDED')
    OR NOT EXISTS (SELECT 1 FROM contract_signatures WHERE contract_id=linked.id AND version_id=linked.current_version_id)
    OR NOT EXISTS (SELECT 1 FROM contract_activations WHERE contract_id=linked.id AND version_id=linked.current_version_id)
    OR NOT EXISTS (SELECT 1 FROM solar_construction_postal WHERE request_id=request.id AND status='received') THEN
    RAISE EXCEPTION 'Solar construction requires a linked activated signed contract and confirmed postal originals' USING ERRCODE='23514';
  END IF;
  SELECT COALESCE(max(revision),0) INTO previous_revision FROM solar_construction_progress_events WHERE request_id=request.id;
  IF NEW.revision <> previous_revision+1 OR NEW.actor_user_id IS NULL THEN
    RAISE EXCEPTION 'Solar construction milestones must be recorded in order by a staff actor' USING ERRCODE='23514';
  END IF;
  NEW.recorded_at := clock_timestamp();
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER solar_construction_progress_guard BEFORE INSERT ON solar_construction_progress_events
FOR EACH ROW EXECUTE FUNCTION guard_solar_construction_progress();

--> statement-breakpoint
CREATE FUNCTION guard_solar_construction_progress_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  -- Permit the actor FK to anonymize a deleted account; evidence cannot be rewritten.
  IF TG_OP='UPDATE' AND NEW.actor_user_id IS NULL AND OLD.actor_user_id IS NOT NULL
    AND (to_jsonb(NEW)-'actor_user_id') = (to_jsonb(OLD)-'actor_user_id') THEN RETURN NEW; END IF;
  RAISE EXCEPTION 'Construction progress evidence is immutable' USING ERRCODE='23514';
END;
$$;
--> statement-breakpoint
CREATE TRIGGER solar_construction_progress_immutable BEFORE UPDATE OR DELETE ON solar_construction_progress_events
FOR EACH ROW EXECUTE FUNCTION guard_solar_construction_progress_immutable();
