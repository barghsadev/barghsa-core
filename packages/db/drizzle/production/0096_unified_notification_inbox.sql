ALTER TABLE "in_app_notifications" ALTER COLUMN "profile_id" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "in_app_notifications" ALTER COLUMN "profile_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "in_app_notifications" ADD COLUMN "recipient_user_id" text;--> statement-breakpoint
ALTER TABLE "in_app_notifications" ADD COLUMN "localized_content" jsonb;--> statement-breakpoint
ALTER TABLE "in_app_notifications" ADD CONSTRAINT "in_app_notifications_recipient_user_id_users_user_id_fk" FOREIGN KEY ("recipient_user_id") REFERENCES "public"."users"("user_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_ian_user_created" ON "in_app_notifications" USING btree ("recipient_user_id","created_at" desc);--> statement-breakpoint
ALTER TABLE "in_app_notifications" ADD CONSTRAINT "chk_ian_recipient" CHECK ("in_app_notifications"."profile_id" IS NOT NULL OR "in_app_notifications"."recipient_user_id" IS NOT NULL);
--> statement-breakpoint
-- Preserve legacy rows and their original text/read history. The source table
-- remains for rollback evidence; new writes use only the canonical inbox.
INSERT INTO in_app_notifications(id,profile_id,recipient_user_id,type,title_i18n_key,body_i18n_key,
  localized_content,params,link_route,is_read,read_at,created_at,delivery_key)
SELECT n.id,n.profile_id,n.user_id,n.type::text,'notifications.legacy.title','notifications.legacy.body',
  jsonb_build_object('original',jsonb_build_object('title',n.title,'body',COALESCE(n.body,''))),
  '{}'::jsonb,CASE WHEN n.link LIKE '/app/%' THEN substring(n.link FROM 5) ELSE n.link END,
  n.read,n.read_at,n.created_at,'legacy:'||n.id::text
FROM notifications n
ON CONFLICT DO NOTHING;
