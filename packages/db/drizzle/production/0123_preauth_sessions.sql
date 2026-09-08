CREATE TABLE "preauth_sessions" (
	"id_hash" text PRIMARY KEY NOT NULL,
	"csrf_token" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	CONSTRAINT "preauth_sessions_id_hash_check" CHECK ("preauth_sessions"."id_hash" ~ '^[a-f0-9]{64}$'),
	CONSTRAINT "preauth_sessions_csrf_check" CHECK ("preauth_sessions"."csrf_token" ~ '^[a-f0-9]{64}$'),
	CONSTRAINT "preauth_sessions_deadline_check" CHECK ("preauth_sessions"."expires_at" > "preauth_sessions"."created_at")
);
--> statement-breakpoint
CREATE INDEX "preauth_sessions_expires_idx" ON "preauth_sessions" USING btree ("expires_at");