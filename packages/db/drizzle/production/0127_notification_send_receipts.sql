CREATE TABLE "notification_send_receipts" (
	"outbox_id" uuid NOT NULL,
	"channel" text NOT NULL,
	"status" text NOT NULL,
	"provider_id" uuid,
	"transport" text,
	"idempotency_key" text NOT NULL,
	"attempt_token" uuid NOT NULL,
	"provider_ref" text,
	"last_error" text,
	"accepted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "notification_send_receipts_outbox_id_channel_pk" PRIMARY KEY("outbox_id","channel"),
	CONSTRAINT "notification_send_channel_check" CHECK ("notification_send_receipts"."channel" IN ('email','sms')),
	CONSTRAINT "notification_send_status_check" CHECK ("notification_send_receipts"."status" IN ('sending','accepted','rejected','unknown')),
	CONSTRAINT "notification_send_identity_check" CHECK (length(btrim("notification_send_receipts"."idempotency_key")) BETWEEN 1 AND 1024),
	CONSTRAINT "notification_send_provider_check" CHECK (("notification_send_receipts"."provider_id" IS NOT NULL AND "notification_send_receipts"."transport" IS NOT NULL AND (("notification_send_receipts"."channel"='email' AND "notification_send_receipts"."transport" IN ('smtp','resend')) OR ("notification_send_receipts"."channel"='sms' AND "notification_send_receipts"."transport"='smsir'))) OR ("notification_send_receipts"."status"='unknown' AND "notification_send_receipts"."provider_id" IS NULL AND "notification_send_receipts"."transport" IS NULL)),
	CONSTRAINT "notification_send_receipt_check" CHECK (("notification_send_receipts"."status"='accepted' AND "notification_send_receipts"."provider_ref" IS NOT NULL AND length(btrim("notification_send_receipts"."provider_ref")) BETWEEN 1 AND 512 AND "notification_send_receipts"."accepted_at" IS NOT NULL) OR ("notification_send_receipts"."status"<>'accepted' AND "notification_send_receipts"."provider_ref" IS NULL AND "notification_send_receipts"."accepted_at" IS NULL))
);
--> statement-breakpoint
ALTER TABLE "notification_send_receipts" ADD CONSTRAINT "notification_send_receipts_outbox_id_channel_notification_job_outbox_id_channel_fk" FOREIGN KEY ("outbox_id","channel") REFERENCES "public"."notification_job"("outbox_id","channel") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
-- Stop/drain all older senders before applying this migration. Preserve legacy
-- attempts with uncertain outcomes; never assume an absent receipt means no send.
INSERT INTO notification_send_receipts(outbox_id,channel,status,idempotency_key,attempt_token,last_error)
SELECT j.outbox_id,j.channel,'unknown','legacy:'||j.outbox_id::text||':'||j.channel,gen_random_uuid(),
  'Legacy external delivery requires reconciliation before another send'
FROM notification_job j JOIN notification_outbox o ON o.id=j.outbox_id
WHERE j.channel IN ('email','sms') AND j.status<>'done' AND (
  j.attempts>0 OR o.attempts>0 OR o.status='sending'
  OR EXISTS (SELECT 1 FROM notification_delivery_log l WHERE l.notification_id=j.outbox_id AND l.channel=j.channel)
  OR EXISTS (SELECT 1 FROM notification_dead_letter d WHERE d.job_id=j.id)
)
ON CONFLICT (outbox_id,channel) DO NOTHING;
