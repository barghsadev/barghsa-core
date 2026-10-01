ALTER TABLE "ticket_comments" ADD COLUMN "body_format" text DEFAULT 'plain' NOT NULL;--> statement-breakpoint
ALTER TABLE "ticket_comments" ADD COLUMN "attachments" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "ticket_comments" ADD COLUMN "author_context" text DEFAULT 'unknown' NOT NULL;--> statement-breakpoint
ALTER TABLE "ticket_comments" ADD COLUMN "submission_id" uuid;--> statement-breakpoint
ALTER TABLE "ticket_comments" ADD COLUMN "submission_hash" text;--> statement-breakpoint
CREATE UNIQUE INDEX "ticket_comments_submission_unique" ON "ticket_comments" USING btree ("ticket_id","author_id","submission_id") WHERE "ticket_comments"."submission_id" IS NOT NULL;--> statement-breakpoint
ALTER TABLE "ticket_comments" ADD CONSTRAINT "ticket_comments_body_format_check" CHECK ("ticket_comments"."body_format" IN ('plain','markdown'));--> statement-breakpoint
ALTER TABLE "ticket_comments" ADD CONSTRAINT "ticket_comments_author_context_check" CHECK ("ticket_comments"."author_context" IN ('customer','staff','unknown'));--> statement-breakpoint
ALTER TABLE "ticket_comments" ADD CONSTRAINT "ticket_comments_attachments_check" CHECK (jsonb_typeof("ticket_comments"."attachments")='array' AND jsonb_array_length("ticket_comments"."attachments")<=5);--> statement-breakpoint
ALTER TABLE "ticket_comments" ADD CONSTRAINT "ticket_comments_submission_check" CHECK (("ticket_comments"."submission_id" IS NULL AND "ticket_comments"."submission_hash" IS NULL) OR ("ticket_comments"."submission_id" IS NOT NULL AND "ticket_comments"."submission_hash" IS NOT NULL AND "ticket_comments"."submission_hash" ~ '^[a-f0-9]{64}$'));