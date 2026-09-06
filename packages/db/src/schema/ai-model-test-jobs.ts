import { sql } from 'drizzle-orm';
import { pgTable, uuid, text, integer, timestamp, jsonb, index, check } from 'drizzle-orm/pg-core';
import { aiModels } from './ai-models.js';
import { users } from './users.js';
export const aiModelTestJobs = pgTable(
  'ai_model_test_jobs',
  {
    id: uuid('id').primaryKey(),
    modelId: uuid('model_id').references(() => aiModels.id, { onDelete: 'set null' }),
    modelRevision: text('model_revision').notNull(),
    actorUserId: text('actor_user_id')
      .notNull()
      .references(() => users.userId, { onDelete: 'cascade' }),
    status: text('status', { enum: ['pending', 'leased', 'completed', 'failed', 'cancelled'] })
      .notNull()
      .default('pending'),
    attempts: integer('attempts').notNull().default(0),
    leaseToken: uuid('lease_token'),
    leaseUntil: timestamp('lease_until', { withTimezone: true }),
    deadlineAt: timestamp('deadline_at', { withTimezone: true }).notNull(),
    result: jsonb('result'),
    errorCode: text('error_code'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    // Queue transitions explicitly update this field in the same statement.
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('ai_model_test_due_idx').on(t.status, t.createdAt),
    index('ai_model_test_model_idx').on(t.modelId),
    index('ai_model_test_actor_idx').on(t.actorUserId),
    check(
      'ai_model_test_status',
      sql`${t.status} IN ('pending','leased','completed','failed','cancelled')`
    ),
    check('ai_model_test_attempts', sql`${t.attempts} BETWEEN 0 AND 2`),
    check(
      'ai_model_test_lease',
      sql`(${t.status}='leased' AND ${t.leaseToken} IS NOT NULL AND ${t.leaseUntil} IS NOT NULL) OR (${t.status}<>'leased' AND ${t.leaseToken} IS NULL AND ${t.leaseUntil} IS NULL)`
    ),
    check('ai_model_test_result', sql`(${t.status}='completed') = (${t.result} IS NOT NULL)`),
    check('ai_model_test_deadline', sql`${t.deadlineAt} > ${t.createdAt}`),
  ]
);
export type AiModelTestJob = typeof aiModelTestJobs.$inferSelect;
