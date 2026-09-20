-- Drain older notification workers before this migration and the updated worker.
-- Retain legacy processing rows. Existing receipts are evidence snapshots, not
-- reconstructed physical attempts; missing pre-migration history cannot be invented.
ALTER TABLE "notification_delivery_log" DROP CONSTRAINT "chk_ndl_status";--> statement-breakpoint
ALTER TABLE "notification_delivery_log" ADD COLUMN "send_attempt_token" uuid;--> statement-breakpoint
ALTER TABLE "notification_send_receipts" ADD COLUMN "attempt_number" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "notification_delivery_log" ADD CONSTRAINT "notification_delivery_log_send_attempt_token_unique" UNIQUE("send_attempt_token");--> statement-breakpoint
ALTER TABLE "notification_delivery_log" ADD CONSTRAINT "chk_ndl_status" CHECK ((status IN ('delivered', 'failed', 'sending', 'unknown')));--> statement-breakpoint
ALTER TABLE "notification_send_receipts" ADD CONSTRAINT "notification_send_attempt_check" CHECK ("notification_send_receipts"."attempt_number" > 0);
--> statement-breakpoint
UPDATE notification_send_receipts r SET attempt_number=GREATEST(1,
  COALESCE((SELECT MAX(l.attempt_number) FROM notification_delivery_log l WHERE l.notification_id=r.outbox_id AND l.channel=r.channel),0),
  COALESCE((SELECT j.attempts FROM notification_job j WHERE j.outbox_id=r.outbox_id AND j.channel=r.channel),0));
--> statement-breakpoint
INSERT INTO notification_delivery_log(notification_id,channel,status,attempt_number,send_attempt_token,provider_ref,error_detail,created_at)
SELECT outbox_id,channel,CASE status WHEN 'accepted' THEN 'delivered' WHEN 'rejected' THEN 'failed' ELSE status END,
  attempt_number,attempt_token,provider_ref,last_error,created_at
FROM notification_send_receipts
ON CONFLICT (send_attempt_token) DO NOTHING;
