ALTER TABLE "ai_agents" ADD COLUMN "system_prompt" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "ai_agents" ADD COLUMN "temperature" double precision;--> statement-breakpoint
ALTER TABLE "ai_agents" ADD COLUMN "max_tokens" integer;--> statement-breakpoint
ALTER TABLE "ai_agents" ADD COLUMN "link_mode" text DEFAULT 'any_kb' NOT NULL;
--> statement-breakpoint
ALTER TABLE "ai_agents" ADD CONSTRAINT "ai_agent_temperature_valid" CHECK (temperature IS NULL OR (temperature >= 0 AND temperature <= 2));
--> statement-breakpoint
ALTER TABLE "ai_agents" ADD CONSTRAINT "ai_agent_max_tokens_valid" CHECK (max_tokens IS NULL OR max_tokens BETWEEN 1 AND 8192);
--> statement-breakpoint
ALTER TABLE "ai_agents" ADD CONSTRAINT "ai_agent_link_mode_valid" CHECK (link_mode IN ('any_kb', 'all_kbs'));
--> statement-breakpoint
ALTER TABLE "ai_agents" ADD CONSTRAINT "ai_agent_system_prompt_length" CHECK (char_length(system_prompt) <= 8000);
