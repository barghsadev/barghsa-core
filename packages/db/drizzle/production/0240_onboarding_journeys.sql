CREATE TABLE "profile_onboarding_journeys" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"user_id" text NOT NULL,
	"request_id" uuid NOT NULL,
	"individual_profile_id" uuid,
	"legal_profile_id" uuid,
	"selected_profile_id" uuid,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "profile_onboarding_journeys_individual_profile_id_unique" UNIQUE("individual_profile_id"),
	CONSTRAINT "profile_onboarding_journeys_legal_profile_id_unique" UNIQUE("legal_profile_id"),
	CONSTRAINT "onboarding_journey_profiles" CHECK ("profile_onboarding_journeys"."individual_profile_id" IS NOT NULL OR "profile_onboarding_journeys"."legal_profile_id" IS NOT NULL),
	CONSTRAINT "onboarding_journey_distinct_profiles" CHECK ("profile_onboarding_journeys"."individual_profile_id" IS DISTINCT FROM "profile_onboarding_journeys"."legal_profile_id"),
	CONSTRAINT "onboarding_journey_completed" CHECK (("profile_onboarding_journeys"."completed_at" IS NULL AND "profile_onboarding_journeys"."selected_profile_id" IS NULL) OR
    ("profile_onboarding_journeys"."completed_at" IS NOT NULL AND "profile_onboarding_journeys"."selected_profile_id" IS NOT NULL AND
    COALESCE("profile_onboarding_journeys"."selected_profile_id"="profile_onboarding_journeys"."individual_profile_id" OR "profile_onboarding_journeys"."selected_profile_id"="profile_onboarding_journeys"."legal_profile_id", false)))
);
--> statement-breakpoint
ALTER TABLE "profile_onboarding_journeys" ADD CONSTRAINT "profile_onboarding_journeys_user_id_users_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("user_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "profile_onboarding_journeys" ADD CONSTRAINT "profile_onboarding_journeys_individual_profile_id_profiles_id_fk" FOREIGN KEY ("individual_profile_id") REFERENCES "public"."profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "profile_onboarding_journeys" ADD CONSTRAINT "profile_onboarding_journeys_legal_profile_id_profiles_id_fk" FOREIGN KEY ("legal_profile_id") REFERENCES "public"."profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "onboarding_journey_request" ON "profile_onboarding_journeys" USING btree ("user_id","request_id");--> statement-breakpoint
CREATE UNIQUE INDEX "onboarding_journey_open" ON "profile_onboarding_journeys" USING btree ("user_id") WHERE "profile_onboarding_journeys"."completed_at" IS NULL;