CREATE TABLE "solar_customer_drafts" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"user_id" text NOT NULL,
	"profile_id" uuid NOT NULL,
	"data" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "solar_customer_drafts_data" CHECK (jsonb_typeof("solar_customer_drafts"."data")='object' AND octet_length("solar_customer_drafts"."data"::text)<=8192)
);
--> statement-breakpoint
ALTER TABLE "solar_customer_drafts" ADD CONSTRAINT "solar_customer_drafts_user_id_users_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("user_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "solar_customer_drafts" ADD CONSTRAINT "solar_customer_drafts_profile_id_profiles_id_fk" FOREIGN KEY ("profile_id") REFERENCES "public"."profiles"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "solar_customer_drafts_owner_key" ON "solar_customer_drafts" USING btree ("user_id","profile_id");--> statement-breakpoint
CREATE TRIGGER modify_updated_at BEFORE UPDATE ON public.solar_customer_drafts
  FOR EACH ROW EXECUTE FUNCTION public.modify_updated_at();
