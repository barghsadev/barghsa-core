CREATE TABLE "conversation_identities" (
	"user_id" text PRIMARY KEY NOT NULL,
	"display_name" text,
	"avatar_key" text,
	"revision" integer DEFAULT 1 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "conversation_identity_name" CHECK ("conversation_identities"."display_name" IS NULL OR (char_length("conversation_identities"."display_name") BETWEEN 1 AND 80 AND "conversation_identities"."display_name"=btrim("conversation_identities"."display_name") AND "conversation_identities"."display_name" !~ '[[:cntrl:]]')),
	CONSTRAINT "conversation_identity_avatar" CHECK ("conversation_identities"."avatar_key" IS NULL OR "conversation_identities"."avatar_key" ~ '^conversation-avatars/[a-f0-9-]{36}/[a-f0-9]{64}$'),
	CONSTRAINT "conversation_identity_revision" CHECK ("conversation_identities"."revision" > 0)
);
--> statement-breakpoint
ALTER TABLE "conversation_identities" ADD CONSTRAINT "conversation_identities_user_id_users_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("user_id") ON DELETE cascade ON UPDATE no action;