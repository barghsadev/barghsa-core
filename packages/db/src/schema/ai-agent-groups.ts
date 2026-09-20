import { index, pgTable, primaryKey, uuid } from 'drizzle-orm/pg-core';
import { timestamptz } from '../types.js';
import { aiAgents } from './ai-agents.js';
import { kbGroups } from './kb-groups.js';
import { aiPolicyGroups } from './ai-policy-groups.js';

/** Agent references to whole groups; direct KB/policy links remain independent. */
export const aiAgentKbGroups = pgTable(
  'ai_agent_kb_groups',
  {
    agentId: uuid('agent_id')
      .notNull()
      .references(() => aiAgents.id, { onDelete: 'cascade' }),
    groupId: uuid('group_id')
      .notNull()
      .references(() => kbGroups.id, { onDelete: 'cascade' }),
    createdAt: timestamptz('created_at').defaultNow().notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.agentId, table.groupId] }),
    index('idx_aiakg_group_id').on(table.groupId),
  ]
);

export const aiAgentPolicyGroups = pgTable(
  'ai_agent_policy_groups',
  {
    agentId: uuid('agent_id')
      .notNull()
      .references(() => aiAgents.id, { onDelete: 'cascade' }),
    groupId: uuid('group_id')
      .notNull()
      .references(() => aiPolicyGroups.id, { onDelete: 'cascade' }),
    createdAt: timestamptz('created_at').defaultNow().notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.agentId, table.groupId] }),
    index('idx_aiapg_group_id').on(table.groupId),
  ]
);
