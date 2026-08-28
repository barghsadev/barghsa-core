import { pgTable, text, uuid, index, boolean, primaryKey } from 'drizzle-orm/pg-core'
import { desc } from 'drizzle-orm'
import { uuidv7, timestamptz } from '../types.js'
import { users } from './users.js'
import { aiModels } from './ai-models.js'
import { knowledgeBases } from './knowledge-bases.js'
import { aiPolicies } from './ai-policies.js'

/**
 * AI agent record (S-09.11, T-09.11.04).
 *
 * One row = one configured AI agent the admin can reference from slots and
 * integrations (T-09.11.05). An agent ties together the admin AI primitives:
 *
 * - `title` — human-friendly label.
 * - `description` — free-text notes about the agent's purpose.
 * - `modelId` — the AI model (T-09.11.01) this agent talks to. RESTRICT on
 *   delete: an agent must never silently lose its brain, so deleting a
 *   referenced model fails with a 409 (AI_MODEL_IN_USE) in the models API.
 * - `enabled` — active/inactive flag; disabled agents cannot be assigned to
 *   slots (slot assignment lands with T-09.11.05).
 * - Links (`aiAgentKbs`, `aiAgentPolicies`) — the referenced knowledge
 *   bases (T-09.11.02) and usage policies (T-09.11.03). The epic's agent
 *   config contract is model_id + kb_ids[] + policy_ids[]; the link tables
 *   persist those arrays.
 *
 * The CHECK constraint on non-empty `title` and the `updated_at` trigger
 * live in migration 0045; `ai-agents.test.ts` pins them.
 */
export const aiAgents = pgTable(
  'ai_agents',
  {
    id: uuidv7('id').primaryKey().notNull(),

    /** Human-friendly label shown in the admin UI. */
    title: text('title').notNull(),

    /** Free-text description of the agent's purpose. */
    description: text('description').notNull().default(''),

    /** AI model endpoint this agent talks to (ai_models.id). */
    modelId: uuid('model_id')
      .notNull()
      .references(() => aiModels.id, { onDelete: 'restrict' }),

    /** Active/inactive flag; drives the list status column. */
    enabled: boolean('enabled').notNull().default(true),

    /** Admin user who created this agent. */
    createdBy: text('created_by')
      .notNull()
      .references(() => users.userId, { onDelete: 'restrict' }),

    createdAt: timestamptz('created_at').defaultNow().notNull(),
    updatedAt: timestamptz('updated_at')
      .defaultNow()
      .notNull()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    /** List by recency for the admin UI (migration 0045, mirrored DESC). */
    index('idx_aia_created_at').on(desc(table.createdAt)),
    /** Admin list model filter + referential integrity (migration 0045). */
    index('idx_aia_model_id').on(table.modelId),
  ],
)

/**
 * AI agent knowledge-base link (S-09.11, T-09.11.04).
 *
 * Join table between {@link aiAgents} and {@link knowledgeBases}: one row
 * per (agent, KB) pair, persisting the `kb_ids[]` part of the agent config.
 * The composite PK doubles as the lookup index for "KBs of agent X".
 *
 * Deleting either side cascades to the link row; a KB can ground several
 * agents and an agent can reference several KBs.
 */
export const aiAgentKbs = pgTable(
  'ai_agent_kbs',
  {
    /** Owning agent (UUID PK of ai_agents). */
    agentId: uuid('agent_id')
      .notNull()
      .references(() => aiAgents.id, { onDelete: 'cascade' }),

    /** Referenced knowledge base (UUID PK of knowledge_bases). */
    kbId: uuid('kb_id')
      .notNull()
      .references(() => knowledgeBases.id, { onDelete: 'cascade' }),

    /** When the KB was linked to the agent. */
    createdAt: timestamptz('created_at').defaultNow().notNull(),
  },
  (table) => [
    /** Composite PK: a KB is linked to an agent exactly once (migration 0045). */
    primaryKey({ columns: [table.agentId, table.kbId] }),
    /** KB links of one agent (admin detail view). */
    index('idx_aiak_agent_id').on(table.agentId),
    /** Reverse lookup for KB delete cascade (migration 0045). */
    index('idx_aiak_kb_id').on(table.kbId),
  ],
)

/**
 * AI agent policy link (S-09.11, T-09.11.04).
 *
 * Join table between {@link aiAgents} and {@link aiPolicies}: one row per
 * (agent, policy) pair, persisting the `policy_ids[]` part of the agent
 * config. The composite PK doubles as the lookup index.
 *
 * Deleting either side cascades to the link row; a policy can constrain
 * several agents and an agent can enforce several policies.
 */
export const aiAgentPolicies = pgTable(
  'ai_agent_policies',
  {
    /** Owning agent (UUID PK of ai_agents). */
    agentId: uuid('agent_id')
      .notNull()
      .references(() => aiAgents.id, { onDelete: 'cascade' }),

    /** Referenced usage policy (UUID PK of ai_policies). */
    policyId: uuid('policy_id')
      .notNull()
      .references(() => aiPolicies.id, { onDelete: 'cascade' }),

    /** When the policy was linked to the agent. */
    createdAt: timestamptz('created_at').defaultNow().notNull(),
  },
  (table) => [
    /** Composite PK: a policy is linked to an agent exactly once (migration 0045). */
    primaryKey({ columns: [table.agentId, table.policyId] }),
    /** Policy links of one agent (admin detail view). */
    index('idx_aiap_agent_id').on(table.agentId),
    /** Reverse lookup for policy delete cascade (migration 0045). */
    index('idx_aiap_policy_id').on(table.policyId),
  ],
)
