import { sql } from 'drizzle-orm';
import { bigint, check, pgTable, uuid } from 'drizzle-orm/pg-core';
import { timestamptz } from '../types.js';
import { aiModels } from './ai-models.js';

/** Optional monthly limits for actual chat completions, in tokens and USD micros. */
export const aiModelBudgets = pgTable(
  'ai_model_budgets',
  {
    modelId: uuid('model_id')
      .primaryKey()
      .references(() => aiModels.id, { onDelete: 'cascade' }),
    monthlyTokenLimit: bigint('monthly_token_limit', { mode: 'number' }),
    monthlyCostLimitMicros: bigint('monthly_cost_limit_micros', { mode: 'number' }),
    inputPricePerMillionMicros: bigint('input_price_per_million_micros', {
      mode: 'number',
    })
      .notNull()
      .default(0),
    outputPricePerMillionMicros: bigint('output_price_per_million_micros', {
      mode: 'number',
    })
      .notNull()
      .default(0),
    usedInputTokens: bigint('used_input_tokens', { mode: 'number' }).notNull().default(0),
    usedOutputTokens: bigint('used_output_tokens', { mode: 'number' }).notNull().default(0),
    usedCostMicros: bigint('used_cost_micros', { mode: 'number' }).notNull().default(0),
    periodStart: timestamptz('period_start')
      .notNull()
      .default(sql`(date_trunc('month', now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC')`),
    alertedAt: timestamptz('alerted_at'),
    createdAt: timestamptz('created_at').notNull().defaultNow(),
    updatedAt: timestamptz('updated_at').notNull().defaultNow(),
  },
  (table) => [
    check(
      'ai_model_budgets_limits',
      sql`(${table.monthlyTokenLimit} IS NULL OR ${table.monthlyTokenLimit} > 0)
        AND (${table.monthlyCostLimitMicros} IS NULL OR ${table.monthlyCostLimitMicros} > 0)`
    ),
    check(
      'ai_model_budgets_nonnegative',
      sql`${table.inputPricePerMillionMicros} >= 0 AND ${table.outputPricePerMillionMicros} >= 0
        AND ${table.usedInputTokens} >= 0 AND ${table.usedOutputTokens} >= 0
        AND ${table.usedCostMicros} >= 0`
    ),
    check(
      'ai_model_budgets_cost_prices',
      sql`${table.monthlyCostLimitMicros} IS NULL OR
        (${table.inputPricePerMillionMicros} > 0 AND ${table.outputPricePerMillionMicros} > 0)`
    ),
  ]
);
