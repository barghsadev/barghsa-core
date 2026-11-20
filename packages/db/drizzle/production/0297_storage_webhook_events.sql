CREATE TABLE "storage_webhook_events" (
	"event_id" text PRIMARY KEY NOT NULL,
	"encrypted_payload" text NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"available_at" timestamp with time zone DEFAULT now() NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"processed_at" timestamp with time zone,
	"outcome" text,
	CONSTRAINT "storage_webhook_event_id" CHECK ("storage_webhook_events"."event_id" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "storage_webhook_attempts" CHECK ("storage_webhook_events"."attempts" >= 0),
	CONSTRAINT "storage_webhook_event_outcome" CHECK (("storage_webhook_events"."processed_at" IS NULL AND "storage_webhook_events"."outcome" IS NULL)
          OR ("storage_webhook_events"."processed_at" IS NOT NULL AND "storage_webhook_events"."outcome" IS NOT NULL
              AND "storage_webhook_events"."outcome" IN ('observed', 'ignored')))
);
--> statement-breakpoint
CREATE INDEX "storage_webhook_events_due_idx" ON "storage_webhook_events" USING btree ("available_at","event_id") WHERE "storage_webhook_events"."processed_at" IS NULL;