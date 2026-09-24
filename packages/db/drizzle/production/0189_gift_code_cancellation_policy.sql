ALTER TABLE "gift_code_redemptions" ADD COLUMN "restored_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "gift_codes" ADD COLUMN "restore_on_cancel" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "gift_codes" ADD COLUMN "restore_after_payment" boolean DEFAULT false NOT NULL;
--> statement-breakpoint
UPDATE "gift_code_redemptions" SET "restored_at" = "updated_at" WHERE "status" = 'released' AND "restored_at" IS NULL;
