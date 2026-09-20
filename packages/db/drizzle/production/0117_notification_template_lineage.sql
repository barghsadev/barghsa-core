-- Preserve legacy publication identities. Resolve duplicate version claims before rollout.
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM notification_templates GROUP BY event_key,channel,locale,version HAVING count(*)>1) THEN
    RAISE EXCEPTION 'Notification template history contains duplicate versions; review audit/notification-template-history-review.sql before migration';
  END IF;
END $$;
--> statement-breakpoint
ALTER TABLE "notification_templates" ADD COLUMN "supersedes_version" integer;
--> statement-breakpoint
CREATE UNIQUE INDEX "uq_notification_templates_version" ON "notification_templates" USING btree ("event_key","channel","locale","version");
--> statement-breakpoint
ALTER TABLE "notification_templates" ADD CONSTRAINT "notification_template_supersedes_fk" FOREIGN KEY ("event_key","channel","locale","supersedes_version") REFERENCES "public"."notification_templates"("event_key","channel","locale","version") ON DELETE restrict ON UPDATE restrict;
--> statement-breakpoint
ALTER TABLE "notification_templates" ADD CONSTRAINT "notification_template_version_positive" CHECK ("notification_templates"."version" > 0);
--> statement-breakpoint
ALTER TABLE "notification_templates" ADD CONSTRAINT "notification_template_supersedes_older" CHECK ("notification_templates"."supersedes_version" IS NULL OR "notification_templates"."supersedes_version" < "notification_templates"."version");
