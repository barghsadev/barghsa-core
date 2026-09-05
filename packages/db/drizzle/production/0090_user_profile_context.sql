CREATE TABLE "user_profile_contexts" (
	"user_id" text PRIMARY KEY NOT NULL,
	"profile_id" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "user_profile_contexts" ADD CONSTRAINT "user_profile_contexts_user_id_users_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("user_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_profile_contexts" ADD CONSTRAINT "user_profile_contexts_profile_id_profiles_id_fk" FOREIGN KEY ("profile_id") REFERENCES "public"."profiles"("id") ON DELETE set null ON UPDATE no action;