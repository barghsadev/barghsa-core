ALTER TABLE "auth_delivery_outbox" ADD COLUMN "sent_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "auth_delivery_outbox" ADD COLUMN "notice_user_id" text;--> statement-breakpoint
-- Do not replay historical successful sends. Only new delivery intents opt in.
ALTER TABLE "auth_delivery_outbox" ADD COLUMN "inbox_notice_pending" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "auth_delivery_outbox" ALTER COLUMN "inbox_notice_pending" SET DEFAULT true;--> statement-breakpoint
ALTER TABLE "auth_delivery_outbox" ADD CONSTRAINT "auth_delivery_outbox_notice_user_id_users_user_id_fk" FOREIGN KEY ("notice_user_id") REFERENCES "public"."users"("user_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "auth_delivery_inbox_notice_idx" ON "auth_delivery_outbox" USING btree ("sent_at","id") WHERE "auth_delivery_outbox"."status"='sent' AND "auth_delivery_outbox"."kind"='otp' AND "auth_delivery_outbox"."inbox_notice_pending" AND "auth_delivery_outbox"."notice_user_id" IS NOT NULL;
--> statement-breakpoint
CREATE FUNCTION capture_auth_delivery_notice() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='INSERT' AND NEW.kind='otp' THEN
  SELECT user_id INTO NEW.notice_user_id FROM otp_challenges WHERE challenge_id=NEW.challenge_id;
 END IF;
 IF TG_OP='UPDATE' AND NEW.status='sent' AND OLD.status IS DISTINCT FROM 'sent' AND NEW.sent_at IS NULL THEN
  NEW.sent_at:=clock_timestamp();
 END IF;
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER auth_delivery_notice_capture BEFORE INSERT OR UPDATE OF status ON auth_delivery_outbox
FOR EACH ROW EXECUTE FUNCTION capture_auth_delivery_notice();
--> statement-breakpoint
-- Preserve legacy template history. Replace only active secret-bearing inbox
-- definitions; email/SMS templates and existing inbox content are untouched.
DO $$
DECLARE previous notification_templates%ROWTYPE; next_version integer;
BEGIN
 FOR previous IN SELECT * FROM notification_templates WHERE event_key='auth.otp_sent'
  AND channel='in_app' AND status='active' AND is_active=true
  AND (body_template LIKE '%{{verificationCode}}%' OR variables::text LIKE '%verificationCode%')
 LOOP
  SELECT max(version)+1 INTO next_version FROM notification_templates
   WHERE event_key=previous.event_key AND channel=previous.channel AND locale=previous.locale;
  UPDATE notification_templates SET status='archived',is_active=false,updated_at=clock_timestamp() WHERE id=previous.id;
  INSERT INTO notification_templates(id,event_key,channel,locale,subject,body_template,variables,status,version,supersedes_version,is_active,published_at)
  VALUES(gen_random_uuid(),previous.event_key,previous.channel,previous.locale,
   CASE WHEN previous.locale='fa' THEN 'کد تأیید ارسال شد' ELSE 'Verification code sent' END,
   CASE WHEN previous.locale='fa' THEN 'کد تأیید برای {{purpose}} از طریق {{channel}} در {{sentAt}} ارسال شد. کد فقط در راه ارتباطی تأییدشده شما قابل مشاهده است.'
    ELSE 'A verification code for {{purpose}} was sent through {{channel}} at {{sentAt}}. The code is available only through your verified contact.' END,
   '[{"name":"purpose","description":"Verification purpose"},{"name":"channel","description":"Delivery channel"},{"name":"sentAt","description":"Delivery time"}]'::jsonb,
   'active',next_version,previous.version,true,clock_timestamp());
 END LOOP;
END $$;
