CREATE TABLE "electricity_orders" (
	"id" uuid PRIMARY KEY NOT NULL,
	"mode" text DEFAULT 'simple' NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"settings_snapshot" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "electricity_orders_mode" CHECK ("electricity_orders"."mode" IN ('simple', 'advanced')),
	CONSTRAINT "electricity_orders_status" CHECK ("electricity_orders"."status" IN ('draft', 'submitted', 'awaiting_staff_review', 'changes_requested', 'approved', 'active', 'completed', 'rejected', 'cancelled')),
	CONSTRAINT "electricity_orders_settings_snapshot_object" CHECK (jsonb_typeof("electricity_orders"."settings_snapshot") = 'object')
);
--> statement-breakpoint
ALTER TABLE "electricity_orders" ADD CONSTRAINT "electricity_orders_id_orders_id_fk" FOREIGN KEY ("id") REFERENCES "public"."orders"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "electricity_orders_status_idx" ON "electricity_orders" USING btree ("status");
--> statement-breakpoint
CREATE FUNCTION guard_electricity_order_settings_snapshot() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Electricity order history is retained' USING ERRCODE = '23514';
  END IF;
  IF OLD.status <> 'draft' AND NEW.settings_snapshot IS DISTINCT FROM OLD.settings_snapshot THEN
    RAISE EXCEPTION 'Submitted electricity settings snapshot is immutable' USING ERRCODE = '23514';
  END IF;
  IF OLD.status <> 'draft' AND NEW.status = 'draft' THEN
    RAISE EXCEPTION 'Submitted electricity orders cannot return to draft' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER electricity_order_settings_snapshot_guard
BEFORE UPDATE OR DELETE ON electricity_orders
FOR EACH ROW EXECUTE FUNCTION guard_electricity_order_settings_snapshot();
