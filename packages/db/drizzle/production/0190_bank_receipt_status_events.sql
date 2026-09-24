CREATE TABLE "bank_receipt_status_events" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"receipt_id" uuid NOT NULL,
	"state" text NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"backfilled" boolean DEFAULT false NOT NULL,
	CONSTRAINT "chk_bank_receipt_status_events_state" CHECK ("bank_receipt_status_events"."state" IN ('Submitted', 'UnderReview', 'Confirmed', 'Rejected'))
);
--> statement-breakpoint
ALTER TABLE "bank_receipt_status_events" ADD CONSTRAINT "bank_receipt_status_events_receipt_id_bank_receipts_id_fk" FOREIGN KEY ("receipt_id") REFERENCES "bank_receipts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_bank_receipt_status_events_receipt_time" ON "bank_receipt_status_events" USING btree ("receipt_id","occurred_at","id");
--> statement-breakpoint
-- Preserve the known endpoints of older receipts. updated_at is only an
-- approximation for historical UnderReview/Rejected transitions.
INSERT INTO bank_receipt_status_events (receipt_id, state, occurred_at, backfilled)
SELECT id, 'Submitted', created_at, true FROM bank_receipts;
--> statement-breakpoint
INSERT INTO bank_receipt_status_events (receipt_id, state, occurred_at, backfilled)
SELECT id, state, COALESCE(confirmed_at, updated_at), true
  FROM bank_receipts WHERE state <> 'Submitted';
--> statement-breakpoint
CREATE OR REPLACE FUNCTION record_bank_receipt_status_event()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO bank_receipt_status_events (receipt_id, state, occurred_at)
    VALUES (NEW.id, NEW.state, NEW.created_at);
  ELSIF NEW.state IS DISTINCT FROM OLD.state THEN
    INSERT INTO bank_receipt_status_events (receipt_id, state, occurred_at)
    VALUES (NEW.id, NEW.state, clock_timestamp());
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER trg_bank_receipt_status_event
AFTER INSERT OR UPDATE OF state ON bank_receipts
FOR EACH ROW EXECUTE FUNCTION record_bank_receipt_status_event();
