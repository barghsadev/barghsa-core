CREATE TABLE "saving_fulfillment_stages" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"order_id" uuid NOT NULL,
	"stage" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	CONSTRAINT "saving_fulfillment_stage" CHECK ("saving_fulfillment_stages"."stage" IN ('review','procurement','dispatch','installation','completion')),
	CONSTRAINT "saving_fulfillment_status" CHECK ("saving_fulfillment_stages"."status" IN ('pending','in_progress','completed')),
	CONSTRAINT "saving_fulfillment_completion" CHECK ("saving_fulfillment_stages"."status"<>'completed' OR "saving_fulfillment_stages"."completed_at" IS NOT NULL)
);
--> statement-breakpoint
CREATE TABLE "saving_order_lines" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"order_id" uuid NOT NULL,
	"description" text NOT NULL,
	"amount" bigint NOT NULL,
	"type" text NOT NULL,
	CONSTRAINT "saving_order_lines_type" CHECK ("saving_order_lines"."type" IN ('plan_price','hardware_price','discount','vat')),
	CONSTRAINT "saving_order_lines_amount" CHECK (("saving_order_lines"."type"='discount' AND "saving_order_lines"."amount"<=0) OR ("saving_order_lines"."type"<>'discount' AND "saving_order_lines"."amount">=0))
);
--> statement-breakpoint
CREATE TABLE "saving_order_submissions" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"user_id" text NOT NULL,
	"idempotency_key" uuid NOT NULL,
	"request_hash" text NOT NULL,
	"order_id" uuid NOT NULL,
	"response" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "saving_orders" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"order_id" uuid NOT NULL,
	"profile_id" uuid NOT NULL,
	"saving_plan_id" uuid NOT NULL,
	"hardware_product_id" uuid NOT NULL,
	"bill_identifier" varchar(13) NOT NULL,
	"installation_address_id" uuid NOT NULL,
	"agreement_version_id" uuid NOT NULL,
	"agreement_snapshot" text NOT NULL,
	"address_snapshot" jsonb NOT NULL,
	"pricing_snapshot" jsonb NOT NULL,
	"verification_result" jsonb NOT NULL,
	"status" text DEFAULT 'submitted' NOT NULL,
	"financial_status" text DEFAULT 'unpaid' NOT NULL,
	"submitted_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "saving_orders_bill_identifier" CHECK ("saving_orders"."bill_identifier" ~ '^[0-9]{6,13}$'),
	CONSTRAINT "saving_orders_status" CHECK ("saving_orders"."status" IN ('draft','submitted','awaiting_staff_review','approved','in_progress','completed','cancelled','rejected')),
	CONSTRAINT "saving_orders_financial_status" CHECK ("saving_orders"."financial_status" IN ('unpaid','paid','refund_pending','refunded')),
	CONSTRAINT "saving_orders_snapshots" CHECK (jsonb_typeof("saving_orders"."address_snapshot")='object' AND jsonb_typeof("saving_orders"."pricing_snapshot")='object' AND jsonb_typeof("saving_orders"."verification_result")='object')
);
--> statement-breakpoint
ALTER TABLE "saving_fulfillment_stages" ADD CONSTRAINT "saving_fulfillment_stages_order_id_saving_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."saving_orders"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "saving_order_lines" ADD CONSTRAINT "saving_order_lines_order_id_saving_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."saving_orders"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "saving_order_submissions" ADD CONSTRAINT "saving_order_submissions_user_id_users_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("user_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "saving_order_submissions" ADD CONSTRAINT "saving_order_submissions_order_id_saving_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."saving_orders"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "saving_orders" ADD CONSTRAINT "saving_orders_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "saving_orders" ADD CONSTRAINT "saving_orders_profile_id_profiles_id_fk" FOREIGN KEY ("profile_id") REFERENCES "public"."profiles"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "saving_orders" ADD CONSTRAINT "saving_orders_saving_plan_id_products_id_fk" FOREIGN KEY ("saving_plan_id") REFERENCES "public"."products"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "saving_orders" ADD CONSTRAINT "saving_orders_hardware_product_id_products_id_fk" FOREIGN KEY ("hardware_product_id") REFERENCES "public"."products"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "saving_orders" ADD CONSTRAINT "saving_orders_installation_address_id_addresses_id_fk" FOREIGN KEY ("installation_address_id") REFERENCES "public"."addresses"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "saving_orders" ADD CONSTRAINT "saving_orders_agreement_version_id_saving_plan_agreement_versions_id_fk" FOREIGN KEY ("agreement_version_id") REFERENCES "public"."saving_plan_agreement_versions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "saving_fulfillment_order_stage_key" ON "saving_fulfillment_stages" USING btree ("order_id","stage");--> statement-breakpoint
CREATE INDEX "saving_order_lines_order_idx" ON "saving_order_lines" USING btree ("order_id");--> statement-breakpoint
CREATE UNIQUE INDEX "saving_order_submission_user_key" ON "saving_order_submissions" USING btree ("user_id","idempotency_key");--> statement-breakpoint
CREATE UNIQUE INDEX "saving_orders_order_key" ON "saving_orders" USING btree ("order_id");--> statement-breakpoint
CREATE INDEX "saving_orders_profile_submitted_idx" ON "saving_orders" USING btree ("profile_id","submitted_at");--> statement-breakpoint
CREATE UNIQUE INDEX "saving_orders_active_bill_plan_key" ON "saving_orders" USING btree ("bill_identifier","saving_plan_id") WHERE "saving_orders"."status" IN ('submitted','awaiting_staff_review','approved','in_progress');
--> statement-breakpoint
CREATE FUNCTION sync_saving_order_financial_status() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.order_id IS NOT NULL AND NEW.type = 'auto' THEN
    UPDATE saving_orders SET financial_status = CASE NEW.state
      WHEN 'Paid' THEN 'paid'
      WHEN 'PartiallyRefunded' THEN 'refund_pending'
      WHEN 'Refunded' THEN 'refunded'
      ELSE 'unpaid' END,
      updated_at = NOW()
    WHERE order_id = NEW.order_id;
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER saving_order_financial_status_sync
AFTER INSERT OR UPDATE OF state ON invoices
FOR EACH ROW EXECUTE FUNCTION sync_saving_order_financial_status();
