ALTER TABLE "notification_job" ADD COLUMN "delivery_payload" jsonb;
--> statement-breakpoint
-- Previously attempted external delivery has no immutable message snapshot.
-- Preserve evidence and require reconciliation before risking a changed replay.
UPDATE notification_outbox o SET status='failed',locked_until=NULL,lease_token=NULL,
  last_error='legacy_email_snapshot_requires_reconciliation'
WHERE o.status IN ('queued','scheduled','sending') AND EXISTS (
  SELECT 1 FROM notification_job j WHERE j.outbox_id=o.id AND j.channel='email'
  AND j.attempts>0 AND j.status NOT IN ('done','failed','dead_letter') AND j.delivery_payload IS NULL
);
