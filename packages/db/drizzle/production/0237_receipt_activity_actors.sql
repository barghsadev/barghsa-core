ALTER TABLE "bank_receipt_status_events" ADD COLUMN "actor_user_id" text;--> statement-breakpoint
ALTER TABLE "bank_receipt_status_events" ADD COLUMN "actor_type" text DEFAULT 'unknown' NOT NULL;--> statement-breakpoint
ALTER TABLE "bank_receipt_status_events" ADD COLUMN "reason" text;--> statement-breakpoint
ALTER TABLE "conversation_identities" ADD COLUMN "share_in_payment_activity" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "bank_receipt_status_events" ADD CONSTRAINT "bank_receipt_status_events_actor_user_id_users_user_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("user_id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_receipt_status_actor" ON "bank_receipt_status_events" USING btree ("actor_user_id");--> statement-breakpoint
ALTER TABLE "bank_receipt_status_events" ADD CONSTRAINT "chk_receipt_status_actor_type" CHECK ("bank_receipt_status_events"."actor_type" IN ('customer', 'staff', 'unknown'));--> statement-breakpoint
ALTER TABLE "bank_receipt_status_events" ADD CONSTRAINT "chk_receipt_status_actor" CHECK ("bank_receipt_status_events"."actor_type" <> 'unknown' OR "bank_receipt_status_events"."actor_user_id" IS NULL);--> statement-breakpoint
ALTER TABLE "conversation_identities" ADD CONSTRAINT "conversation_identity_payment_name" CHECK (NOT "conversation_identities"."share_in_payment_activity" OR "conversation_identities"."display_name" IS NOT NULL);
--> statement-breakpoint
-- Capture evidence only for the receipt explicitly bound to this transaction.
-- Existing events stay unknown; current receipt/audit data cannot prove their original actor.
CREATE OR REPLACE FUNCTION record_bank_receipt_status_event()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  context jsonb;
  event_actor text;
  event_actor_type text := 'unknown';
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.state IS NOT DISTINCT FROM OLD.state THEN
    RETURN NEW;
  END IF;
  context := NULLIF(current_setting('barghsa.receipt_actor', true), '')::jsonb;
  IF context->>'receiptId' = NEW.id::text THEN
    event_actor := NULLIF(context->>'userId', '');
    IF event_actor IS NOT NULL THEN
      event_actor_type := COALESCE(context->>'actorType', 'unknown');
    END IF;
  END IF;
  INSERT INTO bank_receipt_status_events
    (receipt_id,state,occurred_at,actor_user_id,actor_type,reason)
  VALUES (NEW.id,NEW.state,
    CASE WHEN TG_OP = 'INSERT' THEN NEW.created_at ELSE clock_timestamp() END,
    event_actor,event_actor_type,
    CASE WHEN NEW.state='Submitted' THEN NEW.customer_note
      WHEN NEW.state='Rejected' THEN NEW.rejection_reason ELSE NULL END);
  RETURN NEW;
END;
$$;
