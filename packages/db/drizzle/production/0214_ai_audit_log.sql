CREATE TABLE "ai_audit_log" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"session_id" text,
	"user_id" text,
	"profile_id" uuid,
	"agent_slot" text,
	"tool_name" text NOT NULL,
	"input" jsonb NOT NULL,
	"output" jsonb NOT NULL,
	"authorization_result" text NOT NULL,
	"confirmation_required" boolean DEFAULT false NOT NULL,
	"confirmation_result" text,
	"correlation_id" uuid NOT NULL,
	"token_usage" jsonb,
	"latency_ms" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "idx_ai_audit_created_at" ON "ai_audit_log" USING btree ("created_at" desc);--> statement-breakpoint
CREATE INDEX "idx_ai_audit_user_created" ON "ai_audit_log" USING btree ("user_id","created_at" desc);--> statement-breakpoint
CREATE INDEX "idx_ai_audit_correlation" ON "ai_audit_log" USING btree ("correlation_id");
--> statement-breakpoint
ALTER TABLE "ai_audit_log" ADD CONSTRAINT "chk_ai_audit_tool_name"
  CHECK (char_length(tool_name) BETWEEN 1 AND 120);
--> statement-breakpoint
ALTER TABLE "ai_audit_log" ADD CONSTRAINT "chk_ai_audit_auth"
  CHECK (authorization_result IN ('allowed','denied'));
--> statement-breakpoint
ALTER TABLE "ai_audit_log" ADD CONSTRAINT "chk_ai_audit_confirmation"
  CHECK (confirmation_result IS NULL OR confirmation_result IN
    ('confirmed','rejected','pending','not_required'));
--> statement-breakpoint
ALTER TABLE "ai_audit_log" ADD CONSTRAINT "chk_ai_audit_payload"
  CHECK (jsonb_typeof(input)='object' AND jsonb_typeof(output)='object');
--> statement-breakpoint
ALTER TABLE "ai_audit_log" ADD CONSTRAINT "chk_ai_audit_latency"
  CHECK (latency_ms IS NULL OR latency_ms >= 0);
--> statement-breakpoint
CREATE FUNCTION reject_ai_audit_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'ai_audit_log is append-only' USING ERRCODE='55000';
END
$$;
--> statement-breakpoint
CREATE TRIGGER trg_ai_audit_immutable_row
  BEFORE UPDATE OR DELETE ON "ai_audit_log"
  FOR EACH ROW EXECUTE FUNCTION reject_ai_audit_mutation();
--> statement-breakpoint
CREATE TRIGGER trg_ai_audit_immutable_truncate
  BEFORE TRUNCATE ON "ai_audit_log"
  FOR EACH STATEMENT EXECUTE FUNCTION reject_ai_audit_mutation();
