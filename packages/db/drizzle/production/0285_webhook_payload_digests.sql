ALTER TABLE "email_webhook_events" ADD COLUMN "payload_sha256" text;--> statement-breakpoint
ALTER TABLE "wallet_chargeback_events" ADD COLUMN "payload_sha256" text;--> statement-breakpoint
ALTER TABLE "wallet_topup_callback_events" ADD COLUMN "payload_sha256" text;--> statement-breakpoint
ALTER TABLE "email_webhook_events" ADD CONSTRAINT "email_webhook_payload_sha256" CHECK ("email_webhook_events"."payload_sha256" ~ '^[0-9a-f]{64}$');--> statement-breakpoint
ALTER TABLE "wallet_chargeback_events" ADD CONSTRAINT "wallet_chargeback_payload_sha256" CHECK ("wallet_chargeback_events"."payload_sha256" ~ '^[0-9a-f]{64}$');--> statement-breakpoint
ALTER TABLE "wallet_topup_callback_events" ADD CONSTRAINT "wallet_topup_callback_payload_sha256" CHECK ("wallet_topup_callback_events"."payload_sha256" ~ '^[0-9a-f]{64}$');