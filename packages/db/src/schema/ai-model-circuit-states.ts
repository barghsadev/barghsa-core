import { sql } from 'drizzle-orm';
import { boolean, integer, pgTable, text, uuid } from 'drizzle-orm/pg-core';
import { timestamptz } from '../types.js';
import { aiModels } from './ai-models.js';

/** Provider health changes do not alter the model configuration revision. */
export const aiModelCircuitStates = pgTable('ai_model_circuit_states', {
  id: uuid('id')
    .primaryKey()
    .references(() => aiModels.id, { onDelete: 'cascade' }),
  degraded: boolean('degraded').notNull().default(false),
  degradedReason: text('degraded_reason'),
  consecutiveFailures: integer('consecutive_failures').notNull().default(0),
  windowFailures: integer('window_failures').notNull().default(0),
  recentFailureTimes: timestamptz('recent_failure_times')
    .array()
    .notNull()
    .default(sql`'{}'::timestamptz[]`),
  windowStartedAt: timestamptz('window_started_at'),
  lastFailureAt: timestamptz('last_failure_at'),
  openedAt: timestamptz('opened_at'),
  cooldownUntil: timestamptz('cooldown_until'),
});
