ALTER TABLE "ai_policies" ADD COLUMN "priority" integer DEFAULT 100 NOT NULL;--> statement-breakpoint
ALTER TABLE "ai_policy_group_members" ADD COLUMN "priority_override" integer;
--> statement-breakpoint
ALTER TABLE "ai_policies" DROP CONSTRAINT "chk_aip_type";
--> statement-breakpoint
ALTER TABLE "ai_policies" ADD CONSTRAINT "chk_aip_type" CHECK
  (policy_type IN ('allowed_topics','disallowed_actions','data_access_scope','response_style',
                   'content_filter','output_format','rate_limit'));
--> statement-breakpoint
ALTER TABLE "ai_policies" ADD CONSTRAINT "chk_aip_priority" CHECK (priority BETWEEN -1000 AND 1000);
--> statement-breakpoint
ALTER TABLE "ai_policy_group_members" ADD CONSTRAINT "chk_aipgm_priority_override"
  CHECK (priority_override IS NULL OR priority_override BETWEEN -1000 AND 1000);
