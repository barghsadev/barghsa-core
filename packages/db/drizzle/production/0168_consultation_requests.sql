CREATE TABLE "consultation_request_events" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"request_id" uuid NOT NULL,
	"status" text NOT NULL,
	"actor_user_id" text NOT NULL,
	"reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "consultation_event_status" CHECK ("consultation_request_events"."status" IN ('submitted','under_review','awaiting_customer_info','offer_pending','offer_accepted','offer_declined','completed','rejected','cancelled'))
);
--> statement-breakpoint
CREATE TABLE "consultation_requests" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"profile_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"product_snapshot" jsonb NOT NULL,
	"submitted_by" text NOT NULL,
	"submission_key" uuid NOT NULL,
	"status" text DEFAULT 'submitted' NOT NULL,
	"staff_owner_id" text,
	"staff_team" varchar(100),
	"fee" bigint,
	"scope" text,
	"deliverables" text,
	"expected_next_step" text,
	"offer_valid_until" timestamp with time zone,
	"invoice_id" uuid,
	"submitted_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "consultation_status" CHECK ("consultation_requests"."status" IN ('submitted','under_review','awaiting_customer_info','offer_pending','offer_accepted','offer_declined','completed','rejected','cancelled')),
	CONSTRAINT "consultation_fee" CHECK ("consultation_requests"."fee" IS NULL OR "consultation_requests"."fee">0)
);
--> statement-breakpoint
ALTER TABLE "consultation_request_events" ADD CONSTRAINT "consultation_request_events_request_id_consultation_requests_id_fk" FOREIGN KEY ("request_id") REFERENCES "public"."consultation_requests"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "consultation_request_events" ADD CONSTRAINT "consultation_request_events_actor_user_id_users_user_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("user_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "consultation_requests" ADD CONSTRAINT "consultation_requests_profile_id_profiles_id_fk" FOREIGN KEY ("profile_id") REFERENCES "public"."profiles"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "consultation_requests" ADD CONSTRAINT "consultation_requests_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "consultation_requests" ADD CONSTRAINT "consultation_requests_submitted_by_users_user_id_fk" FOREIGN KEY ("submitted_by") REFERENCES "public"."users"("user_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "consultation_requests" ADD CONSTRAINT "consultation_requests_staff_owner_id_users_user_id_fk" FOREIGN KEY ("staff_owner_id") REFERENCES "public"."users"("user_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "consultation_requests" ADD CONSTRAINT "consultation_requests_invoice_id_invoices_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."invoices"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "consultation_events_request_idx" ON "consultation_request_events" USING btree ("request_id","created_at","id");--> statement-breakpoint
CREATE UNIQUE INDEX "consultation_submission_key" ON "consultation_requests" USING btree ("submitted_by","submission_key");--> statement-breakpoint
CREATE INDEX "consultation_profile_idx" ON "consultation_requests" USING btree ("profile_id","submitted_at","id");--> statement-breakpoint
CREATE INDEX "consultation_status_idx" ON "consultation_requests" USING btree ("status","submitted_at","id");
--> statement-breakpoint
INSERT INTO products(type,system_key,title,description,price,status)
VALUES
  ('consultation','electricity_generation_station',
   '{"fa":"مشاوره احداث نیروگاه برق","en":"Electricity generation station consultation"}'::jsonb,
   '{"fa":"درخواست مشاوره برای احداث نیروگاه تولید برق","en":"Request advice on establishing an electricity generation station"}'::jsonb,
   NULL,'active'),
  ('consultation','electricity_saving_certificate',
   '{"fa":"مشاوره گواهی صرفه‌جویی برق","en":"Electricity-saving certificate consultation"}'::jsonb,
   '{"fa":"ویژه اشخاص حقوقی برای دریافت گواهی صرفه‌جویی برق","en":"For legal entities seeking an electricity-saving certificate"}'::jsonb,
   NULL,'active')
ON CONFLICT (system_key) DO NOTHING;
--> statement-breakpoint
INSERT INTO product_categories(product_id,category)
SELECT p.id, x.category::product_category
FROM (VALUES
  ('electricity_generation_station','electricity_generation_station_consultation'),
  ('electricity_saving_certificate','electricity_saving_certificate_consultation')
) AS x(system_key,category)
JOIN products p ON p.system_key=x.system_key AND p.type='consultation'
WHERE NOT EXISTS (
  SELECT 1 FROM product_categories pc WHERE pc.product_id=p.id AND pc.category=x.category::product_category
);
