-- Expand only: historical jobs and older writers retain NULL correlation IDs.
ALTER TABLE "ai_model_test_jobs" ADD COLUMN "correlation_id" text;--> statement-breakpoint
ALTER TABLE "auth_delivery_outbox" ADD COLUMN "correlation_id" text;--> statement-breakpoint
ALTER TABLE "notification_outbox" ADD COLUMN "correlation_id" text;