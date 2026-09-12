CREATE TABLE "email_customer_corrections" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"address" text NOT NULL,
	"profile_id" uuid,
	"source_event_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"resolved_at" timestamp with time zone,
	"resolved_by" text,
	"resolution_note" text,
	CONSTRAINT "email_correction_resolution" CHECK (("email_customer_corrections"."resolved_at" IS NULL AND "email_customer_corrections"."resolved_by" IS NULL AND "email_customer_corrections"."resolution_note" IS NULL) OR ("email_customer_corrections"."resolved_at" IS NOT NULL AND "email_customer_corrections"."resolved_by" IS NOT NULL AND "email_customer_corrections"."resolution_note" IS NOT NULL AND length(btrim("email_customer_corrections"."resolution_note")) BETWEEN 1 AND 2000))
);
--> statement-breakpoint
ALTER TABLE "email_suppressions" DROP CONSTRAINT "email_suppressions_profile_id_profiles_id_fk";
--> statement-breakpoint
ALTER TABLE "email_customer_corrections" ADD CONSTRAINT "email_customer_corrections_profile_id_profiles_id_fk" FOREIGN KEY ("profile_id") REFERENCES "public"."profiles"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "email_customer_corrections" ADD CONSTRAINT "email_customer_corrections_source_event_id_email_webhook_events_id_fk" FOREIGN KEY ("source_event_id") REFERENCES "public"."email_webhook_events"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "email_customer_corrections" ADD CONSTRAINT "email_customer_corrections_resolved_by_users_user_id_fk" FOREIGN KEY ("resolved_by") REFERENCES "public"."users"("user_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "uq_email_correction_open_address" ON "email_customer_corrections" USING btree ("address") WHERE "email_customer_corrections"."resolved_at" IS NULL;--> statement-breakpoint
CREATE INDEX "idx_email_correction_created" ON "email_customer_corrections" USING btree ("created_at","id");--> statement-breakpoint
ALTER TABLE "email_suppressions" ADD CONSTRAINT "email_suppressions_profile_id_profiles_id_fk" FOREIGN KEY ("profile_id") REFERENCES "public"."profiles"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
-- Existing complaint suppressions also need an actionable staff follow-up.
INSERT INTO email_customer_corrections(address,profile_id,source_event_id,created_at)
SELECT lower(btrim(address)),profile_id,source_event_id,created_at FROM email_suppressions WHERE reason='complaint'
ON CONFLICT (address) WHERE resolved_at IS NULL DO NOTHING;
