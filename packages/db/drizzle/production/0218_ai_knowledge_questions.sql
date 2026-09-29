CREATE TABLE "ai_knowledge_questions" (
	"session_id" text NOT NULL,
	"request_id" uuid NOT NULL,
	"profile_id" uuid NOT NULL,
	"slot_key" text NOT NULL,
	"agent_id" uuid,
	"request_hash" text NOT NULL,
	"response" jsonb,
	"state" text DEFAULT 'processing' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	"expires_at" timestamp with time zone NOT NULL,
	CONSTRAINT "ai_knowledge_questions_session_id_request_id_pk" PRIMARY KEY("session_id","request_id"),
	CONSTRAINT "ai_knowledge_questions_slot_valid" CHECK ("ai_knowledge_questions"."slot_key" IN ('individual_chatbot', 'legal_entity_chatbot')),
	CONSTRAINT "ai_knowledge_questions_state_valid" CHECK ("ai_knowledge_questions"."state" IN ('processing', 'completed')),
	CONSTRAINT "ai_knowledge_questions_complete" CHECK (("ai_knowledge_questions"."state"='processing' AND "ai_knowledge_questions"."response" IS NULL AND "ai_knowledge_questions"."completed_at" IS NULL)
      OR ("ai_knowledge_questions"."state"='completed' AND "ai_knowledge_questions"."response" IS NOT NULL AND "ai_knowledge_questions"."completed_at" IS NOT NULL)),
	CONSTRAINT "ai_knowledge_questions_expiry_valid" CHECK ("ai_knowledge_questions"."expires_at" > "ai_knowledge_questions"."created_at")
);
--> statement-breakpoint
ALTER TABLE "ai_knowledge_questions" ADD CONSTRAINT "ai_knowledge_questions_session_id_sessions_session_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."sessions"("session_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_knowledge_questions" ADD CONSTRAINT "ai_knowledge_questions_profile_id_profiles_id_fk" FOREIGN KEY ("profile_id") REFERENCES "public"."profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_knowledge_questions" ADD CONSTRAINT "ai_knowledge_questions_agent_id_ai_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."ai_agents"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_ai_knowledge_questions_expires" ON "ai_knowledge_questions" USING btree ("expires_at");