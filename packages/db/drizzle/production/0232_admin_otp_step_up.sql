ALTER TABLE "otp_challenges" DROP CONSTRAINT "otp_challenge_purpose_binding";--> statement-breakpoint
ALTER TABLE "otp_challenges" ADD COLUMN "step_up_session_id" text;--> statement-breakpoint
ALTER TABLE "sessions" ADD COLUMN "otp_step_up_verified_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "otp_challenges" ADD CONSTRAINT "otp_challenges_step_up_session_id_sessions_session_id_fk" FOREIGN KEY ("step_up_session_id") REFERENCES "public"."sessions"("session_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_otp_step_up_session" ON "otp_challenges" USING btree ("step_up_session_id");--> statement-breakpoint
ALTER TABLE "otp_challenges" ADD CONSTRAINT "otp_step_up_session_binding" CHECK (("otp_challenges"."purpose"='step_up' AND "otp_challenges"."step_up_session_id" IS NOT NULL AND "otp_challenges"."auth_version" IS NOT NULL)
        OR ("otp_challenges"."purpose"<>'step_up' AND "otp_challenges"."step_up_session_id" IS NULL));--> statement-breakpoint
ALTER TABLE "otp_challenges" ADD CONSTRAINT "otp_challenge_purpose_binding" CHECK (
    "otp_challenges"."purpose" = 'legacy_invalid'
    OR ("otp_challenges"."purpose" = 'registration' AND "otp_challenges"."user_id" IS NULL
        AND "otp_challenges"."password_hash" IS NOT NULL AND "otp_challenges"."tos_version_id" IS NOT NULL)
    OR ("otp_challenges"."purpose" IN ('login','password_reset','change_username','add_email','add_mobile','step_up')
        AND "otp_challenges"."user_id" IS NOT NULL)
  );