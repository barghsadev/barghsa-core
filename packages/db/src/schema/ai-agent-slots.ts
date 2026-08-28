import { pgTable, text, uuid, index } from 'drizzle-orm/pg-core'
import { timestamptz } from '../types.js'
import { users } from './users.js'
import { aiAgents } from './ai-agents.js'

/**
 * AI agent slot assignment (S-09.11, T-09.11.05).
 *
 * One row per PREDEFINED chatbot slot — Individual, Legal Entity, Staff,
 * Website, Telegram — pointing at the AI agent serving that surface
 * (`aiAgents`, T-09.11.04). Slots are system configuration: the five keys
 * are fixed by a CHECK constraint and a seed (migration 0046); the API only
 * reads the slot list and changes the `agent_id` mapping.
 *
 * - `slotKey` — stable identifier consumed by the frontend and external
 *   integrations (TEXT PK).
 * - `label` — display label (English for now; fa/en dictionaries land with
 *   the deferred admin web UI slice).
 * - `agentId` — FK ai_agents.id with SET NULL: deleting an agent simply
 *   unassigns it from its slots instead of blocking the delete. One agent
 *   may serve several slots; each slot holds at most one agent.
 * - `updatedBy` — last admin who changed the assignment (SET NULL).
 *
 * The CHECK constraints (non-empty label, fixed slot-key set) and the
 * `updated_at` trigger live in migration 0046; `ai-agent-slots.test.ts`
 * pins them so a future `drizzle-kit generate` cannot silently loosen them.
 */
export const aiAgentSlots = pgTable(
  'ai_agent_slots',
  {
    /** Stable slot key, e.g. `individual_chatbot` (TEXT PK). */
    slotKey: text('slot_key').primaryKey().notNull(),

    /** Display label shown in the admin UI. */
    label: text('label').notNull(),

    /** AI agent serving this slot (ai_agents.id); null = unassigned. */
    agentId: uuid('agent_id').references(() => aiAgents.id, {
      onDelete: 'set null',
    }),

    /** Last admin who changed the assignment (users.user_id); null = never. */
    updatedBy: text('updated_by').references(() => users.userId, {
      onDelete: 'set null',
    }),

    updatedAt: timestamptz('updated_at')
      .defaultNow()
      .notNull()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    /** Which slots use an agent ("also used in" warning; SET NULL delete path). */
    index('idx_aias_agent_id').on(table.agentId),
  ],
)
