ALTER TABLE "email_provider_configs" ADD COLUMN "recent_failure_times" timestamp with time zone[] DEFAULT '{}'::timestamptz[] NOT NULL;
--> statement-breakpoint
-- Legacy counters have no individual timestamps. Preserve their earliest
-- recorded time conservatively; exact rolling history accumulates after rollout.
UPDATE email_provider_configs SET recent_failure_times=array_fill(window_started_at,ARRAY[LEAST(window_failures,5)])
WHERE window_started_at IS NOT NULL AND window_failures > 0;
