ALTER TABLE "profile_agents" ADD COLUMN "invited_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "profile_invitations" ADD COLUMN "message" text;
--> statement-breakpoint
ALTER TABLE "profile_invitations" ADD CONSTRAINT "profile_invitations_message_length" CHECK (message IS NULL OR char_length(message) <= 1000);
