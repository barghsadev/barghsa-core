CREATE TABLE "ai_test_chat_turns" (
	"session_id" text NOT NULL,
	"request_id" uuid NOT NULL,
	"conversation_id" uuid NOT NULL,
	"agent_id" uuid,
	"request_hash" text NOT NULL,
	"user_message" text NOT NULL,
	"reply" text,
	"response" jsonb,
	"state" text DEFAULT 'processing' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	"expires_at" timestamp with time zone NOT NULL,
	CONSTRAINT "ai_test_chat_turns_session_id_request_id_pk" PRIMARY KEY("session_id","request_id")
);
--> statement-breakpoint
ALTER TABLE "ai_test_chat_turns" ADD CONSTRAINT "ai_test_chat_turns_session_id_sessions_session_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."sessions"("session_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_test_chat_turns" ADD CONSTRAINT "ai_test_chat_turns_agent_id_ai_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."ai_agents"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_ai_test_chat_conversation" ON "ai_test_chat_turns" USING btree ("session_id","conversation_id","created_at");--> statement-breakpoint
CREATE INDEX "idx_ai_test_chat_expires" ON "ai_test_chat_turns" USING btree ("expires_at");
--> statement-breakpoint
ALTER TABLE "ai_test_chat_turns" ADD CONSTRAINT "ai_test_chat_state_valid" CHECK (state IN ('processing','completed'));
--> statement-breakpoint
ALTER TABLE "ai_test_chat_turns" ADD CONSTRAINT "ai_test_chat_turn_complete" CHECK (
  (state='processing' AND reply IS NULL AND response IS NULL AND completed_at IS NULL)
  OR (state='completed' AND reply IS NOT NULL AND response IS NOT NULL AND completed_at IS NOT NULL)
);
--> statement-breakpoint
ALTER TABLE "ai_test_chat_turns" ADD CONSTRAINT "ai_test_chat_message_length" CHECK (char_length(user_message) BETWEEN 1 AND 4000);
--> statement-breakpoint
ALTER TABLE "ai_test_chat_turns" ADD CONSTRAINT "ai_test_chat_expiry_valid" CHECK (expires_at > created_at);
