CREATE TABLE "analytics_events" (
	"id" uuid PRIMARY KEY NOT NULL,
	"event_name" text NOT NULL,
	"area" text,
	"service" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "analytics_events_shape_check" CHECK (("analytics_events"."event_name" = 'page_view' AND "analytics_events"."area" IN ('customer', 'admin') AND "analytics_events"."service" IS NULL)
          OR ("analytics_events"."event_name" IN ('catalogue_view', 'order_flow_start') AND "analytics_events"."area" IS NULL AND "analytics_events"."service" IN ('electricity', 'saving', 'solar')))
);
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "analytics_consent" boolean;--> statement-breakpoint
CREATE INDEX "analytics_events_name_created_idx" ON "analytics_events" USING btree ("event_name","created_at");