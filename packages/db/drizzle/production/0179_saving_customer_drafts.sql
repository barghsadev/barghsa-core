CREATE TABLE "saving_customer_drafts" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"user_id" text NOT NULL,
	"profile_id" uuid NOT NULL,
	"current_step" integer DEFAULT 1 NOT NULL,
	"data" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "saving_customer_drafts_step" CHECK ("saving_customer_drafts"."current_step" BETWEEN 1 AND 6),
	CONSTRAINT "saving_customer_drafts_data" CHECK (jsonb_typeof("saving_customer_drafts"."data") = 'object' AND octet_length("saving_customer_drafts"."data"::text) <= 8192)
);
--> statement-breakpoint
ALTER TABLE "saving_customer_drafts" ADD CONSTRAINT "saving_customer_drafts_user_id_users_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("user_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "saving_customer_drafts" ADD CONSTRAINT "saving_customer_drafts_profile_id_profiles_id_fk" FOREIGN KEY ("profile_id") REFERENCES "public"."profiles"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "saving_customer_drafts_owner_unique" ON "saving_customer_drafts" USING btree ("user_id","profile_id");