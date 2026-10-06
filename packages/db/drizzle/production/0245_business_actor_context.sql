-- Expand-only: nullable context preserves every legacy row without guessing its mode.
-- Application rollback keeps these columns/checks/triggers; older writers omit context
-- and remain valid. Do not drop captured provenance or rewrite legacy history.
ALTER TABLE "audit_log" ADD COLUMN "operating_context" text;--> statement-breakpoint
ALTER TABLE "consultation_request_events" ADD COLUMN "actor_context" text;--> statement-breakpoint
ALTER TABLE "saving_address_amendments" ADD COLUMN "actor_context" text;--> statement-breakpoint
ALTER TABLE "saving_fulfillment_events" ADD COLUMN "actor_context" text;--> statement-breakpoint
ALTER TABLE "saving_hardware_amendments" ADD COLUMN "actor_context" text;--> statement-breakpoint
ALTER TABLE "saving_hardware_upgrade_requests" ADD COLUMN "actor_context" text;--> statement-breakpoint
ALTER TABLE "saving_order_revisions" ADD COLUMN "actor_context" text;--> statement-breakpoint
ALTER TABLE "solar_construction_progress_events" ADD COLUMN "actor_context" text;--> statement-breakpoint
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_operating_context_valid" CHECK ("audit_log"."operating_context" IN ('staff','customer'));--> statement-breakpoint
ALTER TABLE "consultation_request_events" ADD CONSTRAINT "consultation_request_events_actor_context_valid" CHECK ("consultation_request_events"."actor_context" IN ('staff','customer'));--> statement-breakpoint
ALTER TABLE "saving_address_amendments" ADD CONSTRAINT "saving_address_amendments_actor_context_valid" CHECK ("saving_address_amendments"."actor_context" IN ('staff','customer'));--> statement-breakpoint
ALTER TABLE "saving_fulfillment_events" ADD CONSTRAINT "saving_fulfillment_events_actor_context_valid" CHECK ("saving_fulfillment_events"."actor_context" IN ('staff','customer'));--> statement-breakpoint
ALTER TABLE "saving_hardware_amendments" ADD CONSTRAINT "saving_hardware_amendments_actor_context_valid" CHECK ("saving_hardware_amendments"."actor_context" IN ('staff','customer'));--> statement-breakpoint
ALTER TABLE "saving_hardware_upgrade_requests" ADD CONSTRAINT "saving_hardware_upgrade_requests_actor_context_valid" CHECK ("saving_hardware_upgrade_requests"."actor_context" IN ('staff','customer'));--> statement-breakpoint
ALTER TABLE "saving_order_revisions" ADD CONSTRAINT "saving_order_revisions_actor_context_valid" CHECK ("saving_order_revisions"."actor_context" IN ('staff','customer'));--> statement-breakpoint
ALTER TABLE "solar_construction_progress_events" ADD CONSTRAINT "solar_construction_progress_events_actor_context_valid" CHECK ("solar_construction_progress_events"."actor_context" IN ('staff','customer'));
--> statement-breakpoint
-- Context is captured at INSERT from the actor's transaction-local, matched
-- session scope. Historical rows stay null; current account flags are not evidence.
CREATE FUNCTION capture_business_actor_context() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  scoped_actor text := nullif(current_setting('barghsa.actor_user_id',true),'');
  scoped_context text := nullif(current_setting('barghsa.actor_context',true),'');
  row_actor text := to_jsonb(NEW)->>TG_ARGV[0];
  row_context text := to_jsonb(NEW)->>TG_ARGV[1];
BEGIN
  IF scoped_actor=row_actor AND scoped_context IN ('staff','customer') THEN
    IF row_context IS NOT NULL AND row_context<>scoped_context THEN
      RAISE EXCEPTION 'Acting context does not match the recorded actor' USING ERRCODE='23514';
    END IF;
    NEW := jsonb_populate_record(NEW,jsonb_build_object(TG_ARGV[1],scoped_context));
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE FUNCTION preserve_business_actor_context() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF to_jsonb(NEW)->TG_ARGV[0] IS DISTINCT FROM to_jsonb(OLD)->TG_ARGV[0] THEN
    RAISE EXCEPTION 'Recorded acting context is immutable' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER audit_log_capture_context BEFORE INSERT ON audit_log
 FOR EACH ROW EXECUTE FUNCTION capture_business_actor_context('user_id','operating_context');
--> statement-breakpoint
CREATE TRIGGER audit_log_preserve_context BEFORE UPDATE ON audit_log
 FOR EACH ROW EXECUTE FUNCTION preserve_business_actor_context('operating_context');
--> statement-breakpoint
CREATE TRIGGER consultation_request_events_capture_context BEFORE INSERT ON consultation_request_events
 FOR EACH ROW EXECUTE FUNCTION capture_business_actor_context('actor_user_id','actor_context');
--> statement-breakpoint
CREATE TRIGGER consultation_request_events_preserve_context BEFORE UPDATE ON consultation_request_events
 FOR EACH ROW EXECUTE FUNCTION preserve_business_actor_context('actor_context');
--> statement-breakpoint
CREATE TRIGGER saving_fulfillment_events_capture_context BEFORE INSERT ON saving_fulfillment_events
 FOR EACH ROW EXECUTE FUNCTION capture_business_actor_context('actor_user_id','actor_context');
--> statement-breakpoint
CREATE TRIGGER saving_fulfillment_events_preserve_context BEFORE UPDATE ON saving_fulfillment_events
 FOR EACH ROW EXECUTE FUNCTION preserve_business_actor_context('actor_context');
--> statement-breakpoint
CREATE TRIGGER saving_order_revisions_capture_context BEFORE INSERT ON saving_order_revisions
 FOR EACH ROW EXECUTE FUNCTION capture_business_actor_context('user_id','actor_context');
--> statement-breakpoint
CREATE TRIGGER saving_order_revisions_preserve_context BEFORE UPDATE ON saving_order_revisions
 FOR EACH ROW EXECUTE FUNCTION preserve_business_actor_context('actor_context');
--> statement-breakpoint
CREATE TRIGGER saving_address_amendments_capture_context BEFORE INSERT ON saving_address_amendments
 FOR EACH ROW EXECUTE FUNCTION capture_business_actor_context('actor_user_id','actor_context');
--> statement-breakpoint
CREATE TRIGGER saving_address_amendments_preserve_context BEFORE UPDATE ON saving_address_amendments
 FOR EACH ROW EXECUTE FUNCTION preserve_business_actor_context('actor_context');
--> statement-breakpoint
CREATE TRIGGER saving_hardware_amendments_capture_context BEFORE INSERT ON saving_hardware_amendments
 FOR EACH ROW EXECUTE FUNCTION capture_business_actor_context('actor_user_id','actor_context');
--> statement-breakpoint
CREATE TRIGGER saving_hardware_amendments_preserve_context BEFORE UPDATE ON saving_hardware_amendments
 FOR EACH ROW EXECUTE FUNCTION preserve_business_actor_context('actor_context');
--> statement-breakpoint
CREATE TRIGGER saving_hardware_upgrade_requests_capture_context BEFORE INSERT ON saving_hardware_upgrade_requests
 FOR EACH ROW EXECUTE FUNCTION capture_business_actor_context('actor_user_id','actor_context');
--> statement-breakpoint
CREATE TRIGGER saving_hardware_upgrade_requests_preserve_context BEFORE UPDATE ON saving_hardware_upgrade_requests
 FOR EACH ROW EXECUTE FUNCTION preserve_business_actor_context('actor_context');
--> statement-breakpoint
CREATE TRIGGER solar_construction_progress_events_capture_context BEFORE INSERT ON solar_construction_progress_events
 FOR EACH ROW EXECUTE FUNCTION capture_business_actor_context('actor_user_id','actor_context');
--> statement-breakpoint
CREATE TRIGGER solar_construction_progress_events_preserve_context BEFORE UPDATE ON solar_construction_progress_events
 FOR EACH ROW EXECUTE FUNCTION preserve_business_actor_context('actor_context');
