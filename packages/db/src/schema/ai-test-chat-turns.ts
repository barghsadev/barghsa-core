import { index, jsonb, pgTable, primaryKey, text, uuid } from 'drizzle-orm/pg-core';
import { timestamptz } from '../types.js';
import { sessions } from './sessions.js';
import { aiAgents } from './ai-agents.js';

/** Short-lived, session-scoped admin test-chat turns and idempotency records. */
export const aiTestChatTurns = pgTable(
  'ai_test_chat_turns',
  {
    sessionId: text('session_id')
      .notNull()
      .references(() => sessions.sessionId, { onDelete: 'cascade' }),
    requestId: uuid('request_id').notNull(),
    conversationId: uuid('conversation_id').notNull(),
    agentId: uuid('agent_id').references(() => aiAgents.id, { onDelete: 'set null' }),
    requestHash: text('request_hash').notNull(),
    userMessage: text('user_message').notNull(),
    reply: text('reply'),
    response: jsonb('response').$type<Record<string, unknown>>(),
    state: text('state', { enum: ['processing', 'completed'] } as const)
      .notNull()
      .default('processing'),
    createdAt: timestamptz('created_at').notNull().defaultNow(),
    completedAt: timestamptz('completed_at'),
    expiresAt: timestamptz('expires_at').notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.sessionId, table.requestId] }),
    index('idx_ai_test_chat_conversation').on(
      table.sessionId,
      table.conversationId,
      table.createdAt
    ),
    index('idx_ai_test_chat_expires').on(table.expiresAt),
  ]
);
