CREATE TABLE "async_jobs" (
	"id" uuid PRIMARY KEY NOT NULL,
	"type" text NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"progress_pct" integer DEFAULT 0 NOT NULL,
	"payload" jsonb NOT NULL,
	"result_url" text,
	"error_message" text,
	"created_by" text NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"lease_token" uuid,
	"lease_until" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	CONSTRAINT "async_jobs_status" CHECK ("async_jobs"."status" IN ('queued','processing','completed','failed')),
	CONSTRAINT "async_jobs_type" CHECK ("async_jobs"."type" ~ '^[a-z][a-z0-9-]{0,63}$'),
	CONSTRAINT "async_jobs_progress" CHECK ("async_jobs"."progress_pct" BETWEEN 0 AND 100),
	CONSTRAINT "async_jobs_attempts" CHECK ("async_jobs"."attempts" BETWEEN 0 AND 3),
	CONSTRAINT "async_jobs_lease" CHECK (("async_jobs"."status" = 'processing' AND "async_jobs"."lease_token" IS NOT NULL AND "async_jobs"."lease_until" IS NOT NULL)
        OR ("async_jobs"."status" <> 'processing' AND "async_jobs"."lease_token" IS NULL AND "async_jobs"."lease_until" IS NULL)),
	CONSTRAINT "async_jobs_result" CHECK ("async_jobs"."result_url" IS NULL OR ("async_jobs"."status" = 'completed' AND left("async_jobs"."result_url", 1) = '/' AND left("async_jobs"."result_url", 2) <> '//'))
);
--> statement-breakpoint
ALTER TABLE "async_jobs" ADD CONSTRAINT "async_jobs_created_by_users_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("user_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "async_jobs_status_created_idx" ON "async_jobs" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX "async_jobs_owner_created_idx" ON "async_jobs" USING btree ("created_by","created_at");
