CREATE TABLE "electricity_quantity_increase_requests" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"contract_id" uuid NOT NULL,
	"order_id" uuid NOT NULL,
	"profile_id" uuid NOT NULL,
	"version_id" uuid NOT NULL,
	"requested_by" text NOT NULL,
	"original_kwh" bigint NOT NULL,
	"requested_kwh" bigint NOT NULL,
	"max_percentage" integer NOT NULL,
	"effective_from" timestamp with time zone NOT NULL,
	"period_end" timestamp with time zone NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"reviewed_by" text,
	"review_reason" text,
	"reviewed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "electricity_quantity_increase_amounts" CHECK ("electricity_quantity_increase_requests"."original_kwh">0 AND "electricity_quantity_increase_requests"."requested_kwh">"electricity_quantity_increase_requests"."original_kwh"),
	CONSTRAINT "electricity_quantity_increase_max_percentage" CHECK ("electricity_quantity_increase_requests"."max_percentage" BETWEEN 1 AND 1000),
	CONSTRAINT "electricity_quantity_increase_period" CHECK ("electricity_quantity_increase_requests"."period_end">"electricity_quantity_increase_requests"."effective_from"),
	CONSTRAINT "electricity_quantity_increase_status" CHECK ("electricity_quantity_increase_requests"."status" IN ('pending','rejected','approved','awaiting_signature','awaiting_payment','effective','expired')),
	CONSTRAINT "electricity_quantity_increase_review_reason" CHECK ("electricity_quantity_increase_requests"."review_reason" IS NULL OR length(trim("electricity_quantity_increase_requests"."review_reason")) BETWEEN 1 AND 1000),
	CONSTRAINT "electricity_quantity_increase_review_check" CHECK (("electricity_quantity_increase_requests"."status"='pending' AND "electricity_quantity_increase_requests"."reviewed_by" IS NULL AND "electricity_quantity_increase_requests"."review_reason" IS NULL AND "electricity_quantity_increase_requests"."reviewed_at" IS NULL) OR ("electricity_quantity_increase_requests"."status"<>'pending' AND "electricity_quantity_increase_requests"."reviewed_by" IS NOT NULL AND "electricity_quantity_increase_requests"."reviewed_at" IS NOT NULL))
);
--> statement-breakpoint
ALTER TABLE "electricity_quantity_increase_requests" ADD CONSTRAINT "electricity_quantity_increase_requests_contract_id_contracts_id_fk" FOREIGN KEY ("contract_id") REFERENCES "public"."contracts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "electricity_quantity_increase_requests" ADD CONSTRAINT "electricity_quantity_increase_requests_order_id_electricity_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."electricity_orders"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "electricity_quantity_increase_requests" ADD CONSTRAINT "electricity_quantity_increase_requests_profile_id_profiles_id_fk" FOREIGN KEY ("profile_id") REFERENCES "public"."profiles"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "electricity_quantity_increase_requests" ADD CONSTRAINT "electricity_quantity_increase_requests_requested_by_users_user_id_fk" FOREIGN KEY ("requested_by") REFERENCES "public"."users"("user_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "electricity_quantity_increase_requests" ADD CONSTRAINT "electricity_quantity_increase_requests_reviewed_by_users_user_id_fk" FOREIGN KEY ("reviewed_by") REFERENCES "public"."users"("user_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "electricity_quantity_increase_requests" ADD CONSTRAINT "electricity_quantity_increase_version_fk" FOREIGN KEY ("contract_id","version_id") REFERENCES "public"."contract_versions"("contract_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "electricity_quantity_increase_requests_contract_id_key" ON "electricity_quantity_increase_requests" USING btree ("contract_id");--> statement-breakpoint
CREATE INDEX "electricity_quantity_increase_queue_idx" ON "electricity_quantity_increase_requests" USING btree ("status","created_at","id");