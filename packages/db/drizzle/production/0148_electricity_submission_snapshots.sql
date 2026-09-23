ALTER TABLE "electricity_orders" ADD COLUMN "period_start" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "electricity_orders" ADD COLUMN "period_end" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "electricity_orders" ADD COLUMN "submitted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "electricity_orders" ADD COLUMN "pricing_snapshot" jsonb;--> statement-breakpoint
ALTER TABLE "electricity_orders" ADD CONSTRAINT "electricity_orders_period_range" CHECK ("electricity_orders"."period_start" IS NULL OR "electricity_orders"."period_end" > "electricity_orders"."period_start");--> statement-breakpoint
ALTER TABLE "electricity_orders" ADD CONSTRAINT "electricity_orders_pricing_snapshot_object" CHECK ("electricity_orders"."pricing_snapshot" IS NULL OR jsonb_typeof("electricity_orders"."pricing_snapshot") = 'object');
--> statement-breakpoint
CREATE OR REPLACE FUNCTION guard_electricity_order_settings_snapshot() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Electricity order history is retained' USING ERRCODE = '23514';
  END IF;
  IF OLD.status <> 'draft' AND NEW.status = 'draft' THEN
    RAISE EXCEPTION 'Submitted electricity orders cannot return to draft' USING ERRCODE = '23514';
  END IF;
  IF OLD.status <> 'draft' AND (
    NEW.settings_snapshot IS DISTINCT FROM OLD.settings_snapshot OR
    NEW.pricing_snapshot IS DISTINCT FROM OLD.pricing_snapshot OR
    NEW.period_start IS DISTINCT FROM OLD.period_start OR
    NEW.period_end IS DISTINCT FROM OLD.period_end OR
    NEW.submitted_at IS DISTINCT FROM OLD.submitted_at
  ) THEN
    RAISE EXCEPTION 'Submitted electricity snapshot is immutable' USING ERRCODE = '23514';
  END IF;
  IF NEW.status NOT IN ('draft', 'cancelled') AND (
    NEW.period_start IS NULL OR NEW.period_end IS NULL OR
    NEW.submitted_at IS NULL OR NEW.pricing_snapshot IS NULL OR
    NEW.period_end <= NEW.period_start
  ) THEN
    RAISE EXCEPTION 'Submitted electricity order needs period and pricing snapshot' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;
