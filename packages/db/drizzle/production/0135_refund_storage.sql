CREATE TYPE "public"."refund_destination" AS ENUM('wallet', 'external_bank');--> statement-breakpoint
CREATE TYPE "public"."refund_reconciliation_status" AS ENUM('Pending', 'Confirmed');--> statement-breakpoint
CREATE TYPE "public"."refund_state" AS ENUM('Requested', 'Approved', 'Processing', 'Completed', 'Failed', 'Rejected', 'Cancelled');--> statement-breakpoint
CREATE TABLE "refunds" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"invoice_id" uuid NOT NULL,
	"profile_id" uuid NOT NULL,
	"amount" bigint NOT NULL,
	"state" "refund_state" DEFAULT 'Requested' NOT NULL,
	"destination" "refund_destination" NOT NULL,
	"staff_id" text,
	"idempotency_key" text NOT NULL,
	"bank_reference" text,
	"reconciliation_status" "refund_reconciliation_status",
	CONSTRAINT "refunds_amount_positive" CHECK ("refunds"."amount" > 0),
	CONSTRAINT "refunds_idempotency_key_nonblank" CHECK (length(trim("refunds"."idempotency_key")) > 0),
	CONSTRAINT "refunds_bank_reference_nonblank" CHECK ("refunds"."bank_reference" IS NULL OR length(trim("refunds"."bank_reference")) > 0),
	CONSTRAINT "refunds_destination_fields" CHECK ("refunds"."destination" = 'external_bank' OR ("refunds"."bank_reference" IS NULL AND "refunds"."reconciliation_status" IS NULL)),
	CONSTRAINT "refunds_reconciled_reference" CHECK ("refunds"."reconciliation_status" IS DISTINCT FROM 'Confirmed' OR "refunds"."bank_reference" IS NOT NULL),
	CONSTRAINT "refunds_completed_external" CHECK ("refunds"."state" <> 'Completed' OR "refunds"."destination" <> 'external_bank' OR ("refunds"."bank_reference" IS NOT NULL AND "refunds"."reconciliation_status" IS NOT DISTINCT FROM 'Confirmed'))
);
--> statement-breakpoint
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_staff_id_users_user_id_fk" FOREIGN KEY ("staff_id") REFERENCES "public"."users"("user_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_invoice_profile_fk" FOREIGN KEY ("invoice_id","profile_id") REFERENCES "public"."invoices"("id","profile_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "refunds_idempotency_key_unique" ON "refunds" USING btree ("idempotency_key");--> statement-breakpoint
CREATE INDEX "refunds_invoice_id_idx" ON "refunds" USING btree ("invoice_id");--> statement-breakpoint
CREATE INDEX "refunds_profile_created_idx" ON "refunds" USING btree ("profile_id","created_at","id");--> statement-breakpoint
CREATE INDEX "refunds_state_created_idx" ON "refunds" USING btree ("state","created_at");
--> statement-breakpoint
-- Cross-row limits cannot use a PostgreSQL CHECK subquery. All refund writes
-- serialize on the parent invoice before measuring reservations. Failed requests
-- retain their reservation; rejecting/cancelling releases it. Completion owns
-- the invoice counter update, in the same transaction as the future processor.
CREATE FUNCTION guard_refund_identity() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Refund history cannot be deleted' USING ERRCODE = '23514';
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW.state <> 'Requested' THEN
      RAISE EXCEPTION 'Refunds must start Requested' USING ERRCODE = '23514';
    END IF;
  ELSE
    IF ROW(NEW.id, NEW.invoice_id, NEW.profile_id, NEW.amount, NEW.destination,
           NEW.staff_id, NEW.idempotency_key, NEW.created_at)
       IS DISTINCT FROM
       ROW(OLD.id, OLD.invoice_id, OLD.profile_id, OLD.amount, OLD.destination,
           OLD.staff_id, OLD.idempotency_key, OLD.created_at) THEN
      RAISE EXCEPTION 'Refund identity and amount are immutable' USING ERRCODE = '23514';
    END IF;
    IF OLD.state IN ('Completed', 'Rejected', 'Cancelled') AND
       ROW(NEW.state, NEW.bank_reference, NEW.reconciliation_status)
       IS DISTINCT FROM ROW(OLD.state, OLD.bank_reference, OLD.reconciliation_status) THEN
      RAISE EXCEPTION 'Terminal refunds cannot be reopened or changed' USING ERRCODE = '23514';
    END IF;
    IF NEW.state = 'Completed' AND OLD.state NOT IN ('Processing', 'Completed') THEN
      RAISE EXCEPTION 'Only processing refunds can complete' USING ERRCODE = '23514';
    END IF;
  END IF;
  PERFORM id FROM invoices WHERE id = NEW.invoice_id FOR UPDATE;
  NEW.updated_at := clock_timestamp();
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER refunds_identity_guard BEFORE INSERT OR UPDATE OR DELETE ON refunds
FOR EACH ROW EXECUTE FUNCTION guard_refund_identity();
--> statement-breakpoint
CREATE FUNCTION enforce_refund_budget() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  paid bigint;
  returned bigint;
  reserved numeric;
BEGIN
  SELECT paid_amount, refunded_amount INTO paid, returned
    FROM invoices WHERE id = NEW.invoice_id FOR UPDATE;
  IF TG_OP = 'UPDATE' AND NEW.state = 'Completed' AND OLD.state <> 'Completed' THEN
    -- The invoice guard below sees the completed refund and remaining holds.
    UPDATE invoices SET refunded_amount = refunded_amount + NEW.amount
      WHERE id = NEW.invoice_id RETURNING refunded_amount INTO returned;
  END IF;
  SELECT COALESCE(SUM(amount), 0) INTO reserved FROM refunds
    WHERE invoice_id = NEW.invoice_id AND state NOT IN ('Completed', 'Rejected', 'Cancelled');
  IF reserved + returned > paid THEN
    RAISE EXCEPTION 'Refund reservations exceed the unrefunded paid amount' USING ERRCODE = '23514';
  END IF;
  RETURN NULL;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER refunds_budget_guard AFTER INSERT OR UPDATE ON refunds
FOR EACH ROW EXECUTE FUNCTION enforce_refund_budget();
--> statement-breakpoint
CREATE FUNCTION guard_invoice_refund_budget() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  reserved numeric;
  completed numeric;
BEGIN
  SELECT COALESCE(SUM(amount) FILTER (WHERE state NOT IN ('Completed', 'Rejected', 'Cancelled')), 0),
         COALESCE(SUM(amount) FILTER (WHERE state = 'Completed'), 0)
    INTO reserved, completed FROM refunds WHERE invoice_id = NEW.id;
  IF NEW.refunded_amount < completed OR NEW.refunded_amount + reserved > NEW.paid_amount THEN
    RAISE EXCEPTION 'Invoice amounts conflict with refund history or reservations' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER invoices_refund_budget_guard BEFORE UPDATE OF paid_amount, refunded_amount ON invoices
FOR EACH ROW EXECUTE FUNCTION guard_invoice_refund_budget();
