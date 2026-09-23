CREATE TABLE "solar_construction_documents" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"request_id" uuid NOT NULL,
	"document_id" uuid NOT NULL,
	"file_name" text NOT NULL,
	"staff_status" text DEFAULT 'pending' NOT NULL,
	"staff_reason" text,
	"staff_reviewed_by" text,
	"staff_reviewed_at" timestamp with time zone,
	"uploaded_by" text NOT NULL,
	"uploaded_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "solar_documents_staff_status" CHECK ("solar_construction_documents"."staff_status" IN ('pending','approved','rejected')),
	CONSTRAINT "solar_documents_review" CHECK (("solar_construction_documents"."staff_status"='pending' AND "solar_construction_documents"."staff_reviewed_by" IS NULL AND "solar_construction_documents"."staff_reviewed_at" IS NULL) OR ("solar_construction_documents"."staff_status"<>'pending' AND "solar_construction_documents"."staff_reviewed_by" IS NOT NULL AND "solar_construction_documents"."staff_reviewed_at" IS NOT NULL)),
	CONSTRAINT "solar_documents_rejection_reason" CHECK ("solar_construction_documents"."staff_status"<>'rejected' OR coalesce(length(trim("solar_construction_documents"."staff_reason")),0)>0)
);
--> statement-breakpoint
CREATE TABLE "solar_construction_postal" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"request_id" uuid NOT NULL,
	"status" text DEFAULT 'waiting_for_shipment' NOT NULL,
	"courier" text,
	"tracking_number" text,
	"send_date" timestamp with time zone,
	"receipt_image_id" uuid,
	"staff_confirmed_by" text,
	"staff_confirmed_at" timestamp with time zone,
	"staff_notes" text,
	CONSTRAINT "solar_postal_status" CHECK ("solar_construction_postal"."status" IN ('waiting_for_shipment','shipped','received','incomplete','not_received'))
);
--> statement-breakpoint
CREATE TABLE "solar_construction_requests" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"profile_id" uuid NOT NULL,
	"submitted_by" text NOT NULL,
	"submission_key" uuid NOT NULL,
	"status" text DEFAULT 'submitted' NOT NULL,
	"building_type" text NOT NULL,
	"grid_type" text NOT NULL,
	"bill_identifier" varchar(13),
	"property_form" text,
	"structural_frame" text,
	"building_completion_date" date,
	"total_units" integer,
	"site_category" text,
	"installation_surface" text,
	"usable_area_sqm" numeric(12, 2),
	"site_address_id" uuid,
	"site_relationship" text,
	"site_description" text,
	"agreement_accepted" boolean DEFAULT false NOT NULL,
	"agreement_version" text NOT NULL,
	"agreement_snapshot" text NOT NULL,
	"agreement_accepted_at" timestamp with time zone NOT NULL,
	"submitted_at" timestamp with time zone DEFAULT now() NOT NULL,
	"status_reason" text,
	"support_path" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "solar_requests_building_type" CHECK ("solar_construction_requests"."building_type" IN ('building_apartment','non_household')),
	CONSTRAINT "solar_requests_grid_type" CHECK ("solar_construction_requests"."grid_type" IN ('on_grid','off_grid')),
	CONSTRAINT "solar_requests_bill" CHECK (("solar_construction_requests"."grid_type"='off_grid' AND "solar_construction_requests"."bill_identifier" IS NULL) OR ("solar_construction_requests"."grid_type"='on_grid' AND "solar_construction_requests"."bill_identifier" IS NOT NULL AND "solar_construction_requests"."bill_identifier" ~ '^[0-9]{6,13}$')),
	CONSTRAINT "solar_requests_property_form" CHECK ("solar_construction_requests"."property_form" IS NULL OR "solar_construction_requests"."property_form" IN ('apartment','villa')),
	CONSTRAINT "solar_requests_frame" CHECK ("solar_construction_requests"."structural_frame" IS NULL OR "solar_construction_requests"."structural_frame" IN ('concrete','steel','other')),
	CONSTRAINT "solar_requests_site_category" CHECK ("solar_construction_requests"."site_category" IS NULL OR "solar_construction_requests"."site_category" IN ('agricultural','industrial')),
	CONSTRAINT "solar_requests_surface" CHECK ("solar_construction_requests"."installation_surface" IS NULL OR "solar_construction_requests"."installation_surface" IN ('land','rooftop','both')),
	CONSTRAINT "solar_requests_relationship" CHECK ("solar_construction_requests"."site_relationship" IS NULL OR "solar_construction_requests"."site_relationship" IN ('owner','tenant','authorized_operator')),
	CONSTRAINT "solar_requests_units" CHECK ("solar_construction_requests"."total_units" IS NULL OR "solar_construction_requests"."total_units">0),
	CONSTRAINT "solar_requests_area" CHECK ("solar_construction_requests"."usable_area_sqm" IS NULL OR "solar_construction_requests"."usable_area_sqm">0),
	CONSTRAINT "solar_requests_agreement" CHECK ("solar_construction_requests"."agreement_accepted" AND length(trim("solar_construction_requests"."agreement_version"))>0 AND length(trim("solar_construction_requests"."agreement_snapshot"))>0),
	CONSTRAINT "solar_requests_building_fields" CHECK (("solar_construction_requests"."building_type"='building_apartment' AND "solar_construction_requests"."property_form" IS NOT NULL AND "solar_construction_requests"."structural_frame" IS NOT NULL AND "solar_construction_requests"."building_completion_date" IS NOT NULL AND (("solar_construction_requests"."property_form"='villa' AND "solar_construction_requests"."total_units" IS NULL) OR ("solar_construction_requests"."property_form"='apartment' AND coalesce("solar_construction_requests"."total_units",0)>0)) AND "solar_construction_requests"."site_category" IS NULL AND "solar_construction_requests"."installation_surface" IS NULL AND "solar_construction_requests"."usable_area_sqm" IS NULL AND "solar_construction_requests"."site_address_id" IS NULL AND "solar_construction_requests"."site_relationship" IS NULL AND "solar_construction_requests"."site_description" IS NULL) OR ("solar_construction_requests"."building_type"='non_household' AND "solar_construction_requests"."property_form" IS NULL AND "solar_construction_requests"."structural_frame" IS NULL AND "solar_construction_requests"."building_completion_date" IS NULL AND "solar_construction_requests"."total_units" IS NULL AND "solar_construction_requests"."site_category" IS NOT NULL AND "solar_construction_requests"."installation_surface" IS NOT NULL AND coalesce("solar_construction_requests"."usable_area_sqm",0)>0 AND "solar_construction_requests"."site_address_id" IS NOT NULL AND "solar_construction_requests"."site_relationship" IS NOT NULL)),
	CONSTRAINT "solar_requests_status" CHECK ("solar_construction_requests"."status" IN ('draft','submitted','uploading_documents','documents_under_review','changes_requested','waiting_for_postal_submission','postal_documents_received','final_review','approved','rejected','cancelled','contract_created')),
	CONSTRAINT "solar_requests_decision_reason" CHECK ("solar_construction_requests"."status" NOT IN ('rejected','cancelled') OR (coalesce(length(trim("solar_construction_requests"."status_reason")),0)>0 AND coalesce(length(trim("solar_construction_requests"."support_path")),0)>0))
);
--> statement-breakpoint
ALTER TABLE "solar_construction_documents" ADD CONSTRAINT "solar_construction_documents_request_id_solar_construction_requests_id_fk" FOREIGN KEY ("request_id") REFERENCES "public"."solar_construction_requests"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "solar_construction_documents" ADD CONSTRAINT "solar_construction_documents_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "solar_construction_documents" ADD CONSTRAINT "solar_construction_documents_staff_reviewed_by_users_user_id_fk" FOREIGN KEY ("staff_reviewed_by") REFERENCES "public"."users"("user_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "solar_construction_documents" ADD CONSTRAINT "solar_construction_documents_uploaded_by_users_user_id_fk" FOREIGN KEY ("uploaded_by") REFERENCES "public"."users"("user_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "solar_construction_postal" ADD CONSTRAINT "solar_construction_postal_request_id_solar_construction_requests_id_fk" FOREIGN KEY ("request_id") REFERENCES "public"."solar_construction_requests"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "solar_construction_postal" ADD CONSTRAINT "solar_construction_postal_receipt_image_id_documents_id_fk" FOREIGN KEY ("receipt_image_id") REFERENCES "public"."documents"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "solar_construction_postal" ADD CONSTRAINT "solar_construction_postal_staff_confirmed_by_users_user_id_fk" FOREIGN KEY ("staff_confirmed_by") REFERENCES "public"."users"("user_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "solar_construction_requests" ADD CONSTRAINT "solar_construction_requests_profile_id_profiles_id_fk" FOREIGN KEY ("profile_id") REFERENCES "public"."profiles"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "solar_construction_requests" ADD CONSTRAINT "solar_construction_requests_submitted_by_users_user_id_fk" FOREIGN KEY ("submitted_by") REFERENCES "public"."users"("user_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "solar_construction_requests" ADD CONSTRAINT "solar_construction_requests_site_address_id_addresses_id_fk" FOREIGN KEY ("site_address_id") REFERENCES "public"."addresses"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "solar_documents_document_key" ON "solar_construction_documents" USING btree ("document_id");--> statement-breakpoint
CREATE INDEX "solar_documents_request_idx" ON "solar_construction_documents" USING btree ("request_id","uploaded_at","id");--> statement-breakpoint
CREATE UNIQUE INDEX "solar_postal_request_key" ON "solar_construction_postal" USING btree ("request_id");--> statement-breakpoint
CREATE INDEX "solar_requests_profile_idx" ON "solar_construction_requests" USING btree ("profile_id","created_at","id");--> statement-breakpoint
CREATE INDEX "solar_requests_status_idx" ON "solar_construction_requests" USING btree ("status","created_at","id");--> statement-breakpoint
CREATE UNIQUE INDEX "solar_requests_submission_key" ON "solar_construction_requests" USING btree ("submitted_by","submission_key");