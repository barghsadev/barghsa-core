CREATE TABLE "refund_obligations" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"order_id" uuid NOT NULL,
	"contract_id" uuid,
	"invoice_id" uuid NOT NULL,
	"profile_id" uuid NOT NULL,
	"refund_id" uuid NOT NULL,
	"total_paid_amount" bigint NOT NULL,
	"completed_refund_amount" bigint DEFAULT 0::bigint NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"idempotency_key" text NOT NULL,
	"authorized_by" text NOT NULL,
	"reason" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "refund_obligations_status_check" CHECK ("refund_obligations"."status" IN ('pending','processing','completed','failed')),
	CONSTRAINT "refund_obligations_amount_check" CHECK ("refund_obligations"."total_paid_amount" > 0 AND "refund_obligations"."completed_refund_amount" >= 0 AND "refund_obligations"."completed_refund_amount" <= "refund_obligations"."total_paid_amount"),
	CONSTRAINT "refund_obligations_reason_check" CHECK (length(trim("refund_obligations"."reason")) > 0)
);
--> statement-breakpoint
ALTER TABLE "refund_obligations" ADD CONSTRAINT "refund_obligations_order_id_electricity_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."electricity_orders"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "refund_obligations" ADD CONSTRAINT "refund_obligations_contract_id_contracts_id_fk" FOREIGN KEY ("contract_id") REFERENCES "public"."contracts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "refund_obligations" ADD CONSTRAINT "refund_obligations_invoice_id_invoices_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."invoices"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "refund_obligations" ADD CONSTRAINT "refund_obligations_profile_id_profiles_id_fk" FOREIGN KEY ("profile_id") REFERENCES "public"."profiles"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "refund_obligations" ADD CONSTRAINT "refund_obligations_refund_id_refunds_id_fk" FOREIGN KEY ("refund_id") REFERENCES "public"."refunds"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "refund_obligations" ADD CONSTRAINT "refund_obligations_authorized_by_users_user_id_fk" FOREIGN KEY ("authorized_by") REFERENCES "public"."users"("user_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "refund_obligations_order_unique" ON "refund_obligations" USING btree ("order_id");--> statement-breakpoint
CREATE UNIQUE INDEX "refund_obligations_refund_unique" ON "refund_obligations" USING btree ("refund_id");--> statement-breakpoint
CREATE UNIQUE INDEX "refund_obligations_idempotency_unique" ON "refund_obligations" USING btree ("idempotency_key");--> statement-breakpoint
CREATE INDEX "refund_obligations_status_idx" ON "refund_obligations" USING btree ("status","created_at");
--> statement-breakpoint
CREATE FUNCTION prevent_rejected_electricity_payment() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE previous_paid bigint;
BEGIN
  IF TG_OP = 'INSERT' THEN previous_paid := 0;
  ELSE previous_paid := OLD.paid_amount;
  END IF;
  IF NEW.order_id IS NOT NULL AND NEW.paid_amount > previous_paid AND EXISTS (
    SELECT 1 FROM electricity_orders e WHERE e.id=NEW.order_id
      AND e.status IN ('rejected','cancelled')
  ) THEN
    RAISE EXCEPTION 'Rejected electricity orders cannot receive new payments';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER prevent_rejected_electricity_payment_trigger
  BEFORE INSERT OR UPDATE ON invoices FOR EACH ROW
  EXECUTE FUNCTION prevent_rejected_electricity_payment();
