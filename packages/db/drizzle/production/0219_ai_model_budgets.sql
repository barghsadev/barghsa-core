CREATE TABLE "ai_model_budgets" (
	"model_id" uuid PRIMARY KEY NOT NULL,
	"monthly_token_limit" bigint,
	"monthly_cost_limit_micros" bigint,
	"input_price_per_million_micros" bigint DEFAULT 0 NOT NULL,
	"output_price_per_million_micros" bigint DEFAULT 0 NOT NULL,
	"used_input_tokens" bigint DEFAULT 0 NOT NULL,
	"used_output_tokens" bigint DEFAULT 0 NOT NULL,
	"used_cost_micros" bigint DEFAULT 0 NOT NULL,
	"period_start" timestamp with time zone DEFAULT (date_trunc('month', now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC') NOT NULL,
	"alerted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ai_model_budgets_limits" CHECK (("ai_model_budgets"."monthly_token_limit" IS NULL OR "ai_model_budgets"."monthly_token_limit" > 0)
        AND ("ai_model_budgets"."monthly_cost_limit_micros" IS NULL OR "ai_model_budgets"."monthly_cost_limit_micros" > 0)),
	CONSTRAINT "ai_model_budgets_nonnegative" CHECK ("ai_model_budgets"."input_price_per_million_micros" >= 0 AND "ai_model_budgets"."output_price_per_million_micros" >= 0
        AND "ai_model_budgets"."used_input_tokens" >= 0 AND "ai_model_budgets"."used_output_tokens" >= 0
        AND "ai_model_budgets"."used_cost_micros" >= 0),
	CONSTRAINT "ai_model_budgets_cost_prices" CHECK ("ai_model_budgets"."monthly_cost_limit_micros" IS NULL OR
        ("ai_model_budgets"."input_price_per_million_micros" > 0 AND "ai_model_budgets"."output_price_per_million_micros" > 0))
);
--> statement-breakpoint
ALTER TABLE "ai_model_budgets" ADD CONSTRAINT "ai_model_budgets_model_id_ai_models_id_fk" FOREIGN KEY ("model_id") REFERENCES "public"."ai_models"("id") ON DELETE cascade ON UPDATE no action;
