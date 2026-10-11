CREATE TABLE "operations_alert_receipts" (
	"id" text PRIMARY KEY NOT NULL,
	"alert_name" text NOT NULL,
	"fingerprint" text NOT NULL,
	"environment" text NOT NULL,
	"database" text NOT NULL,
	"status" text NOT NULL,
	"severity" text NOT NULL,
	"priority" text,
	"starts_at" timestamp with time zone NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "operations_alert_status_check" CHECK ("operations_alert_receipts"."status" IN ('firing','resolved')),
	CONSTRAINT "operations_alert_severity_check" CHECK ("operations_alert_receipts"."severity" IN ('warning','critical')),
	CONSTRAINT "operations_alert_priority_check" CHECK ("operations_alert_receipts"."priority" IS NULL OR "operations_alert_receipts"."priority"='P2')
);
--> statement-breakpoint
CREATE FUNCTION prevent_operations_alert_receipt_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'Operations alert receipts are append-only' USING ERRCODE='23514'; END $$;
--> statement-breakpoint
CREATE TRIGGER operations_alert_receipt_immutable BEFORE UPDATE OR DELETE ON operations_alert_receipts
FOR EACH ROW EXECUTE FUNCTION prevent_operations_alert_receipt_mutation();
--> statement-breakpoint
-- The receiver can hold current admin identities without UPDATE authority on users.
CREATE FUNCTION public.lock_operations_alert_admins() RETURNS TABLE(user_id text)
LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
 SELECT u.user_id FROM public.users u WHERE u.is_staff=true AND u.is_admin=true
  AND u.disabled_at IS NULL AND u.activation_token IS NULL ORDER BY u.user_id FOR SHARE OF u;
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.lock_operations_alert_admins() FROM PUBLIC;
