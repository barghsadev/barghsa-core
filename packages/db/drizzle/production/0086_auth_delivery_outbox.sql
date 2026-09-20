CREATE TABLE "auth_delivery_outbox" (
	"id" uuid PRIMARY KEY NOT NULL,
	"challenge_id" text NOT NULL,
	"code_hash" text NOT NULL,
	"encrypted_payload" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"available_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"lease_until" timestamp with time zone,
	"lease_token" uuid,
	"provider_ref" text,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "auth_delivery_status_check" CHECK ("auth_delivery_outbox"."status" IN ('pending','leased','sent','cancelled','dead')),
	CONSTRAINT "auth_delivery_attempts_check" CHECK ("auth_delivery_outbox"."attempts" >= 0)
);
--> statement-breakpoint
ALTER TABLE "auth_delivery_outbox" ADD CONSTRAINT "auth_delivery_outbox_challenge_id_otp_challenges_challenge_id_fk" FOREIGN KEY ("challenge_id") REFERENCES "public"."otp_challenges"("challenge_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "auth_delivery_due_idx" ON "auth_delivery_outbox" USING btree ("status","available_at");