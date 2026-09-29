import { sql } from 'drizzle-orm';
import { check, index, jsonb, pgTable, primaryKey, text, uuid } from 'drizzle-orm/pg-core';
import { timestamptz } from '../types.js';
import { sessions } from './sessions.js';
import { profiles } from './profiles.js';
import { aiAgents } from './ai-agents.js';

/** Short-lived, profile-bound idempotency records for customer knowledge questions. */
export const aiKnowledgeQuestions = pgTable(
  'ai_knowledge_questions',
  {
    sessionId: text('session_id')
      .notNull()
      .references(() => sessions.sessionId, { onDelete: 'cascade' }),
    requestId: uuid('request_id').notNull(),
    profileId: uuid('profile_id')
      .notNull()
      .references(() => profiles.id, { onDelete: 'cascade' }),
    slotKey: text('slot_key', { enum: ['individual_chatbot', 'legal_entity_chatbot'] }).notNull(),
    agentId: uuid('agent_id').references(() => aiAgents.id, { onDelete: 'set null' }),
    requestHash: text('request_hash').notNull(),
    response: jsonb('response').$type<Record<string, unknown>>(),
    state: text('state', { enum: ['processing', 'completed'] })
      .notNull()
      .default('processing'),
    createdAt: timestamptz('created_at').notNull().defaultNow(),
    completedAt: timestamptz('completed_at'),
    expiresAt: timestamptz('expires_at').notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.sessionId, table.requestId] }),
    index('idx_ai_knowledge_questions_expires').on(table.expiresAt),
    check(
      'ai_knowledge_questions_slot_valid',
      sql`${table.slotKey} IN ('individual_chatbot', 'legal_entity_chatbot')`
    ),
    check('ai_knowledge_questions_state_valid', sql`${table.state} IN ('processing', 'completed')`),
    check(
      'ai_knowledge_questions_complete',
      sql`(${table.state}='processing' AND ${table.response} IS NULL AND ${table.completedAt} IS NULL)
      OR (${table.state}='completed' AND ${table.response} IS NOT NULL AND ${table.completedAt} IS NOT NULL)`
    ),
    check('ai_knowledge_questions_expiry_valid', sql`${table.expiresAt} > ${table.createdAt}`),
  ]
);
