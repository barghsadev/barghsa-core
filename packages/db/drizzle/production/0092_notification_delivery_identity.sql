ALTER TABLE "notification_job" ADD COLUMN IF NOT EXISTS "provider_ref" text;
--> statement-breakpoint
ALTER TABLE "in_app_notifications" ADD COLUMN "delivery_key" text;--> statement-breakpoint
ALTER TABLE "notification_outbox" ADD COLUMN "idempotency_version" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "uq_ian_delivery_key" ON "in_app_notifications" USING btree ("delivery_key");
--> statement-breakpoint
ALTER TABLE notification_outbox ALTER COLUMN idempotency_version SET DEFAULT 2;
--> statement-breakpoint
-- Unattempted occurrences can adopt distinct provider keys. Attempted rows
-- keep their original provider identity, including pre-upgrade failures.
UPDATE notification_outbox o SET idempotency_version=2
WHERE o.attempts=0 AND o.status IN ('queued','scheduled')
  AND NOT EXISTS (SELECT 1 FROM notification_delivery_log l WHERE l.notification_id=o.id)
  AND NOT EXISTS (SELECT 1 FROM notification_job j WHERE j.outbox_id=o.id
    AND (j.attempts>0 OR j.status IN ('running','done') OR j.provider_ref IS NOT NULL));
--> statement-breakpoint
-- Bind a documented successful insertion to its original occurrence. Keep
-- historical duplicates and read state intact; do not guess matches by text.
WITH proven AS (
  SELECT DISTINCT ON (l.notification_id) l.notification_id,n.id
  FROM notification_delivery_log l
  JOIN notification_outbox o ON o.id=l.notification_id
  JOIN in_app_notifications n ON n.id::text=l.provider_ref AND n.profile_id=o.profile_id AND n.type=o.event_key
  WHERE l.channel='in_app' AND l.status='delivered'
  ORDER BY l.notification_id,l.created_at,n.id
)
UPDATE in_app_notifications n SET delivery_key='outbox:'||p.notification_id::text
FROM proven p WHERE n.id=p.id AND n.delivery_key IS NULL;
--> statement-breakpoint
WITH proven AS (
  SELECT DISTINCT ON (j.outbox_id) j.outbox_id,n.id
  FROM notification_job j JOIN notification_outbox o ON o.id=j.outbox_id
  JOIN in_app_notifications n ON n.id::text=j.provider_ref AND n.profile_id=o.profile_id AND n.type=o.event_key
  WHERE j.channel='in_app' AND j.status='done'
    AND NOT EXISTS (SELECT 1 FROM in_app_notifications linked WHERE linked.delivery_key='outbox:'||j.outbox_id::text)
  ORDER BY j.outbox_id,n.id
)
UPDATE in_app_notifications n SET delivery_key='outbox:'||p.outbox_id::text
FROM proven p WHERE n.id=p.id AND n.delivery_key IS NULL;
--> statement-breakpoint
-- A legacy crash may have inserted an inbox row without a durable outcome.
-- Hold ambiguous occurrences for reconciliation instead of duplicating them.
UPDATE notification_outbox o
SET status='failed',locked_until=NULL,last_error='legacy_delivery_requires_reconciliation',updated_at=NOW()
WHERE o.status IN ('queued','scheduled','sending') AND 'in_app'=ANY(o.channels)
  AND (o.attempts>0 OR o.status='sending')
  AND NOT EXISTS (SELECT 1 FROM in_app_notifications n WHERE n.delivery_key='outbox:'||o.id::text);
