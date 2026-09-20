ALTER TABLE "otp_challenges" ADD COLUMN "purpose" text DEFAULT 'legacy_invalid' NOT NULL;--> statement-breakpoint
ALTER TABLE "otp_challenges" ADD CONSTRAINT "otp_challenge_purpose_binding" CHECK (
    "otp_challenges"."purpose" = 'legacy_invalid'
    OR ("otp_challenges"."purpose" = 'registration' AND "otp_challenges"."user_id" IS NULL
        AND "otp_challenges"."password_hash" IS NOT NULL AND "otp_challenges"."tos_version_id" IS NOT NULL)
    OR ("otp_challenges"."purpose" IN ('login','password_reset','change_username','add_email','add_mobile')
        AND "otp_challenges"."user_id" IS NOT NULL)
  );
--> statement-breakpoint
-- Legacy OTPs have no reliable purpose or account binding. Preserve their history and invalidate them.
UPDATE otp_challenges SET consumed_at=NOW(),attempts_remaining=0,updated_at=NOW()
WHERE purpose='legacy_invalid' AND consumed_at IS NULL;
