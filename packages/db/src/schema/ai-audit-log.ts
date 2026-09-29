import { boolean, index, integer, jsonb, pgTable, text, uuid } from 'drizzle-orm/pg-core';
import { desc } from 'drizzle-orm';
import { timestamptz, uuidv7 } from '../types.js';

/** Immutable AI inference/tool decision record. Identity values are snapshots. */
export const aiAuditLog = pgTable(
  'ai_audit_log',
  {
    id: uuidv7('id').primaryKey().notNull(),
    sessionId: text('session_id'),
    userId: text('user_id'),
    profileId: uuid('profile_id'),
    agentSlot: text('agent_slot'),
    toolName: text('tool_name').notNull(),
    input: jsonb('input').$type<Record<string, unknown>>().notNull(),
    output: jsonb('output').$type<Record<string, unknown>>().notNull(),
    authorizationResult: text('authorization_result', {
      enum: ['allowed', 'denied'],
    } as const).notNull(),
    confirmationRequired: boolean('confirmation_required').notNull().default(false),
    confirmationResult: text('confirmation_result', {
      enum: ['confirmed', 'rejected', 'pending', 'not_required'],
    } as const),
    correlationId: uuid('correlation_id').notNull(),
    tokenUsage: jsonb('token_usage').$type<{ input: number; output: number }>(),
    latencyMs: integer('latency_ms'),
    createdAt: timestamptz('created_at').notNull().defaultNow(),
  },
  (table) => [
    index('idx_ai_audit_created_at').on(desc(table.createdAt)),
    index('idx_ai_audit_user_created').on(table.userId, desc(table.createdAt)),
    index('idx_ai_audit_correlation').on(table.correlationId),
  ]
);

export type AiAuditRecord = typeof aiAuditLog.$inferSelect;
export type NewAiAuditRecord = typeof aiAuditLog.$inferInsert;
