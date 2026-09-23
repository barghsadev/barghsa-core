CREATE TABLE "saving_fulfillment_events" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"order_id" uuid NOT NULL,
	"stage" text NOT NULL,
	"from_status" text NOT NULL,
	"to_status" text NOT NULL,
	"actor_user_id" text NOT NULL,
	"explanation" text NOT NULL,
	"handover_description" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "saving_fulfillment_events_stage" CHECK ("saving_fulfillment_events"."stage" IN ('request_confirmation','product_delivery','installation_and_document_upload','equipment_handover','process_completion')),
	CONSTRAINT "saving_fulfillment_events_from_status" CHECK ("saving_fulfillment_events"."from_status" IN ('pending','in_progress','completed','skipped')),
	CONSTRAINT "saving_fulfillment_events_to_status" CHECK ("saving_fulfillment_events"."to_status" IN ('in_progress','completed','skipped')),
	CONSTRAINT "saving_fulfillment_events_explanation" CHECK (length(trim("saving_fulfillment_events"."explanation")) BETWEEN 1 AND 1000)
);
--> statement-breakpoint
ALTER TABLE "saving_fulfillment_stages" DROP CONSTRAINT "saving_fulfillment_stage";--> statement-breakpoint
ALTER TABLE "saving_fulfillment_stages" DROP CONSTRAINT "saving_fulfillment_status";--> statement-breakpoint
ALTER TABLE "saving_fulfillment_stages" DROP CONSTRAINT "saving_fulfillment_completion";--> statement-breakpoint
ALTER TABLE "saving_fulfillment_stages" ADD COLUMN "completed_by" text;--> statement-breakpoint
ALTER TABLE "saving_fulfillment_stages" ADD COLUMN "explanation" text;--> statement-breakpoint
ALTER TABLE "saving_fulfillment_stages" ADD COLUMN "handover_description" text;--> statement-breakpoint
UPDATE "saving_fulfillment_stages" SET "stage" = CASE "stage"
  WHEN 'review' THEN 'request_confirmation'
  WHEN 'procurement' THEN 'product_delivery'
  WHEN 'dispatch' THEN 'installation_and_document_upload'
  WHEN 'installation' THEN 'equipment_handover'
  WHEN 'completion' THEN 'process_completion'
  ELSE "stage" END;
--> statement-breakpoint
ALTER TABLE "saving_fulfillment_events" ADD CONSTRAINT "saving_fulfillment_events_order_id_saving_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."saving_orders"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "saving_fulfillment_events" ADD CONSTRAINT "saving_fulfillment_events_actor_user_id_users_user_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("user_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "saving_fulfillment_events_order_idx" ON "saving_fulfillment_events" USING btree ("order_id","created_at","id");--> statement-breakpoint
ALTER TABLE "saving_fulfillment_stages" ADD CONSTRAINT "saving_fulfillment_stages_completed_by_users_user_id_fk" FOREIGN KEY ("completed_by") REFERENCES "public"."users"("user_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "saving_fulfillment_stages" ADD CONSTRAINT "saving_fulfillment_handover" CHECK ("saving_fulfillment_stages"."stage"='equipment_handover' OR "saving_fulfillment_stages"."status"<>'skipped');--> statement-breakpoint
ALTER TABLE "saving_fulfillment_stages" ADD CONSTRAINT "saving_fulfillment_stage" CHECK ("saving_fulfillment_stages"."stage" IN ('request_confirmation','product_delivery','installation_and_document_upload','equipment_handover','process_completion'));--> statement-breakpoint
ALTER TABLE "saving_fulfillment_stages" ADD CONSTRAINT "saving_fulfillment_status" CHECK ("saving_fulfillment_stages"."status" IN ('pending','in_progress','completed','skipped'));--> statement-breakpoint
ALTER TABLE "saving_fulfillment_stages" ADD CONSTRAINT "saving_fulfillment_completion" CHECK ("saving_fulfillment_stages"."status" NOT IN ('completed','skipped') OR ("saving_fulfillment_stages"."completed_at" IS NOT NULL AND "saving_fulfillment_stages"."completed_by" IS NOT NULL));
--> statement-breakpoint
CREATE FUNCTION prevent_saving_fulfillment_event_edit() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Saving fulfillment events are immutable' USING ERRCODE='23514';
END $$;
--> statement-breakpoint
CREATE TRIGGER saving_fulfillment_event_immutable
BEFORE UPDATE OR DELETE ON saving_fulfillment_events
FOR EACH ROW EXECUTE FUNCTION prevent_saving_fulfillment_event_edit();
--> statement-breakpoint
-- Savings follows the same unpublished staff rejection rule as electricity.
CREATE OR REPLACE FUNCTION guard_rejected_electricity_contract() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.state='Rejected' AND NEW.state<>'Rejected' THEN
    RAISE EXCEPTION 'Rejected contracts are terminal' USING ERRCODE='23514';
  END IF;
  IF NEW.state='Rejected' AND OLD.state<>'Rejected' AND (
    NEW.service_type NOT IN ('electricity','savings')
    OR OLD.state NOT IN ('AwaitingStaffReview','ChangesRequested')
    OR EXISTS(SELECT 1 FROM contract_publications WHERE contract_id=NEW.id)
  ) THEN
    RAISE EXCEPTION 'Only unpublished staff-reviewed contracts can be rejected' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
-- Paid saving rejections use the shared refund obligation and worker.
ALTER TABLE "refund_obligations" DROP CONSTRAINT "refund_obligations_order_id_electricity_orders_id_fk";
--> statement-breakpoint
ALTER TABLE "refund_obligations" ADD CONSTRAINT "refund_obligations_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE restrict ON UPDATE no action;
