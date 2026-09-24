ALTER TABLE "ai_models" ADD COLUMN "config" jsonb DEFAULT '{"max_tokens":256,"temperature":0}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "ai_models" ADD COLUMN "is_enabled" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "ai_models" ADD COLUMN "last_test_latency_ms" integer;
--> statement-breakpoint
UPDATE "ai_models" SET "is_enabled"=true WHERE "last_test_status"='passed';
--> statement-breakpoint
ALTER TABLE "ai_models" ADD CONSTRAINT "ai_models_enabled_requires_test"
  CHECK (NOT is_enabled OR last_test_status='passed');
--> statement-breakpoint
ALTER TABLE "ai_models" ADD CONSTRAINT "ai_models_test_latency_nonnegative"
  CHECK (last_test_latency_ms IS NULL OR last_test_latency_ms>=0);
