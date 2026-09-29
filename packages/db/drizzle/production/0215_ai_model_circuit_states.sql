CREATE TABLE "ai_model_circuit_states" (
	"id" uuid PRIMARY KEY NOT NULL,
	"degraded" boolean DEFAULT false NOT NULL,
	"degraded_reason" text,
	"consecutive_failures" integer DEFAULT 0 NOT NULL,
	"window_failures" integer DEFAULT 0 NOT NULL,
	"recent_failure_times" timestamp with time zone[] DEFAULT '{}'::timestamptz[] NOT NULL,
	"window_started_at" timestamp with time zone,
	"last_failure_at" timestamp with time zone,
	"opened_at" timestamp with time zone,
	"cooldown_until" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "provider_health_events" DROP CONSTRAINT "chk_phe_channel";--> statement-breakpoint
ALTER TABLE "ai_model_circuit_states" ADD CONSTRAINT "ai_model_circuit_states_id_ai_models_id_fk" FOREIGN KEY ("id") REFERENCES "public"."ai_models"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "provider_health_events" ADD CONSTRAINT "chk_phe_channel" CHECK ("provider_health_events"."channel" IN ('email','sms','ai'));
--> statement-breakpoint
ALTER TABLE "ai_model_circuit_states" ADD CONSTRAINT "chk_ai_model_breaker_counts"
  CHECK (consecutive_failures >= 0 AND window_failures >= 0);
--> statement-breakpoint
INSERT INTO ai_model_circuit_states(id) SELECT id FROM ai_models;
--> statement-breakpoint
CREATE FUNCTION insert_ai_model_circuit_state() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO ai_model_circuit_states(id) VALUES (NEW.id);
  RETURN NEW;
END
$$;
--> statement-breakpoint
CREATE TRIGGER ai_model_circuit_state_insert
  AFTER INSERT ON ai_models FOR EACH ROW
  EXECUTE FUNCTION insert_ai_model_circuit_state();
--> statement-breakpoint
CREATE TRIGGER ai_model_health_transition
  AFTER UPDATE OF degraded ON ai_model_circuit_states
  FOR EACH ROW WHEN (OLD.degraded IS DISTINCT FROM NEW.degraded)
  EXECUTE FUNCTION record_provider_health_transition('ai');
