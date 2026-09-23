CREATE TABLE "electricity_contracts" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"order_id" uuid NOT NULL,
	"contract_id" uuid NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "electricity_contracts_status" CHECK ("electricity_contracts"."status" IN ('draft', 'active', 'completed', 'cancelled'))
);
--> statement-breakpoint
CREATE TABLE "electricity_order_lines" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"order_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"quantity_kwh" bigint NOT NULL,
	"unit_price" bigint NOT NULL,
	"line_total" bigint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "electricity_order_lines_quantity_positive" CHECK ("electricity_order_lines"."quantity_kwh" > 0),
	CONSTRAINT "electricity_order_lines_money_nonnegative" CHECK ("electricity_order_lines"."unit_price" > 0 AND "electricity_order_lines"."line_total" >= 0)
);
--> statement-breakpoint
CREATE TABLE "electricity_order_submissions" (
	"user_id" text NOT NULL,
	"idempotency_key" uuid NOT NULL,
	"request_hash" text NOT NULL,
	"order_id" uuid NOT NULL,
	"contract_id" uuid NOT NULL,
	"invoice_id" uuid NOT NULL,
	"response" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "electricity_order_submissions_pk" PRIMARY KEY("user_id","idempotency_key")
);
--> statement-breakpoint
ALTER TABLE "electricity_orders" ADD COLUMN "profile_id" uuid;--> statement-breakpoint
UPDATE electricity_orders e SET profile_id=o.profile_id FROM orders o WHERE e.id=o.id;--> statement-breakpoint
ALTER TABLE "electricity_orders" ALTER COLUMN "profile_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "electricity_orders" ADD COLUMN "total_kwh" bigint;--> statement-breakpoint
ALTER TABLE "electricity_orders" ADD COLUMN "average_power_kw" numeric(30, 9);--> statement-breakpoint
ALTER TABLE "electricity_orders" ADD COLUMN "green_rule_applied" boolean;--> statement-breakpoint
ALTER TABLE "electricity_orders" ADD COLUMN "submitted_by" text;--> statement-breakpoint
ALTER TABLE "electricity_contracts" ADD CONSTRAINT "electricity_contracts_order_id_electricity_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."electricity_orders"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "electricity_contracts" ADD CONSTRAINT "electricity_contracts_contract_id_contracts_id_fk" FOREIGN KEY ("contract_id") REFERENCES "public"."contracts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "electricity_order_lines" ADD CONSTRAINT "electricity_order_lines_order_id_electricity_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."electricity_orders"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "electricity_order_lines" ADD CONSTRAINT "electricity_order_lines_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "electricity_order_submissions" ADD CONSTRAINT "electricity_order_submissions_user_id_users_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("user_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "electricity_order_submissions" ADD CONSTRAINT "electricity_order_submissions_order_id_electricity_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."electricity_orders"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "electricity_order_submissions" ADD CONSTRAINT "electricity_order_submissions_contract_id_contracts_id_fk" FOREIGN KEY ("contract_id") REFERENCES "public"."contracts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "electricity_order_submissions" ADD CONSTRAINT "electricity_order_submissions_invoice_id_invoices_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."invoices"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "electricity_contracts_order_unique" ON "electricity_contracts" USING btree ("order_id");--> statement-breakpoint
CREATE UNIQUE INDEX "electricity_contracts_contract_unique" ON "electricity_contracts" USING btree ("contract_id");--> statement-breakpoint
CREATE UNIQUE INDEX "electricity_order_lines_product_unique" ON "electricity_order_lines" USING btree ("order_id","product_id");--> statement-breakpoint
CREATE INDEX "electricity_order_lines_order_idx" ON "electricity_order_lines" USING btree ("order_id");--> statement-breakpoint
ALTER TABLE "electricity_orders" ADD CONSTRAINT "electricity_orders_profile_id_profiles_id_fk" FOREIGN KEY ("profile_id") REFERENCES "public"."profiles"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "electricity_orders" ADD CONSTRAINT "electricity_orders_submitted_by_users_user_id_fk" FOREIGN KEY ("submitted_by") REFERENCES "public"."users"("user_id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE electricity_orders ADD CONSTRAINT electricity_orders_submitted_facts
  CHECK (status IN ('draft', 'cancelled') OR
    (total_kwh > 0 AND average_power_kw >= 0 AND green_rule_applied IS NOT NULL AND submitted_by IS NOT NULL));
--> statement-breakpoint
ALTER TABLE electricity_order_submissions ADD CONSTRAINT electricity_order_submissions_payload
  CHECK (request_hash ~ '^[a-f0-9]{64}$' AND jsonb_typeof(response) = 'object');
--> statement-breakpoint
CREATE FUNCTION guard_electricity_submission_rows() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Submitted electricity records are immutable' USING ERRCODE = '23514';
END $$;
--> statement-breakpoint
CREATE TRIGGER electricity_order_lines_immutable
BEFORE UPDATE OR DELETE ON electricity_order_lines
FOR EACH ROW EXECUTE FUNCTION guard_electricity_submission_rows();
--> statement-breakpoint
CREATE TRIGGER electricity_order_submissions_immutable
BEFORE UPDATE OR DELETE ON electricity_order_submissions
FOR EACH ROW EXECUTE FUNCTION guard_electricity_submission_rows();
