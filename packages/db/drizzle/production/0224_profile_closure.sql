ALTER TABLE "tickets" ADD COLUMN "privacy_closure_completed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "tickets" ADD COLUMN "privacy_closure_actor_id" text;--> statement-breakpoint
ALTER TABLE "tickets" ADD COLUMN "privacy_closure_anonymized" boolean;--> statement-breakpoint
ALTER TABLE "tickets" ADD COLUMN "privacy_closure_retained" jsonb;--> statement-breakpoint
ALTER TABLE "tickets" ADD COLUMN "privacy_closure_export_ticket_id" uuid;--> statement-breakpoint
ALTER TABLE "tickets" ADD CONSTRAINT "tickets_privacy_closure_actor_id_users_user_id_fk" FOREIGN KEY ("privacy_closure_actor_id") REFERENCES "public"."users"("user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tickets" ADD CONSTRAINT "tickets_privacy_closure_valid" CHECK (("tickets"."privacy_closure_completed_at" IS NULL AND "tickets"."privacy_closure_actor_id" IS NULL
        AND "tickets"."privacy_closure_anonymized" IS NULL AND "tickets"."privacy_closure_retained" IS NULL
        AND "tickets"."privacy_closure_export_ticket_id" IS NULL)
        OR ("tickets"."privacy_request_type"='closure' AND "tickets"."privacy_closure_completed_at" IS NOT NULL
          AND "tickets"."privacy_closure_actor_id" IS NOT NULL AND "tickets"."privacy_closure_anonymized" IS NOT NULL
          AND "tickets"."privacy_closure_retained" IS NOT NULL));