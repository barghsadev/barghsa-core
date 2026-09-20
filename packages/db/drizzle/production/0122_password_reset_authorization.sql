ALTER TABLE "otp_challenges" ADD COLUMN "reset_token_hash" text;--> statement-breakpoint
ALTER TABLE "otp_challenges" ADD COLUMN "reset_consumed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "password_reset_challenge_id" uuid;--> statement-breakpoint
CREATE UNIQUE INDEX "uq_otp_reset_token_hash" ON "otp_challenges" USING btree ("reset_token_hash") WHERE "otp_challenges"."reset_token_hash" IS NOT NULL;--> statement-breakpoint
ALTER TABLE "otp_challenges" ADD CONSTRAINT "otp_reset_authorization_state" CHECK (("otp_challenges"."reset_token_hash" IS NULL AND "otp_challenges"."reset_consumed_at" IS NULL)
        OR ("otp_challenges"."reset_token_hash" IS NOT NULL AND "otp_challenges"."purpose"='password_reset' AND "otp_challenges"."user_id" IS NOT NULL
            AND "otp_challenges"."consumed_at" IS NOT NULL AND "otp_challenges"."reset_token_hash" ~ '^[a-f0-9]{64}$'));