CREATE TABLE "electricity_customer_drafts" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"user_id" text NOT NULL,
	"profile_id" uuid NOT NULL,
	"mode" text NOT NULL,
	"current_step" integer DEFAULT 1 NOT NULL,
	"data" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "electricity_customer_drafts_step" CHECK ("electricity_customer_drafts"."current_step" BETWEEN 1 AND 5),
	CONSTRAINT "electricity_customer_drafts_data_object" CHECK (jsonb_typeof("electricity_customer_drafts"."data") = 'object')
);
--> statement-breakpoint
ALTER TABLE "electricity_customer_drafts" ADD CONSTRAINT "electricity_customer_drafts_user_id_users_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("user_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "electricity_customer_drafts" ADD CONSTRAINT "electricity_customer_drafts_profile_id_profiles_id_fk" FOREIGN KEY ("profile_id") REFERENCES "public"."profiles"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "electricity_customer_drafts_owner_unique" ON "electricity_customer_drafts" USING btree ("user_id","profile_id","mode");