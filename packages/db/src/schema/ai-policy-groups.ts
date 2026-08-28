import { index, pgTable, primaryKey, text, uuid } from 'drizzle-orm/pg-core'
import { uuidv7, timestamptz } from '../types.js'
import { users } from './users.js'
import { aiPolicies } from './ai-policies.js'

/**
 * AI policy group (S-09.11, T-09.11.03).
 *
 * One row = one policy group, a named collection of AI usage policies
 * (see {@link aiPolicyGroupMembers}). Groups let an AI agent (T-09.11.04)
 * adopt a coherent set of guardrails without enumerating policies
 * individually.
 *
 * Row layout:
 * - `title`        human-friendly label
 * - `description`  free-text notes
 * - `created_by`   admin user who created the group
 *
 * The CHECK constraint on non-empty `title` and the `updated_at` trigger
 * live in migration 0044; `ai-policies.test.ts` pins them.
 */
export const aiPolicyGroups = pgTable(
  'ai_policy_groups',
  {
    id: uuidv7('id').primaryKey().notNull(),

    /** Human-friendly label shown in the admin UI. */
    title: text('title').notNull(),

    /** Free-text description of the group's purpose. */
    description: text('description').notNull().default(''),

    /** Admin user who created this group. */
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
    /** List by recency for the admin UI (migration 0044). */
    index('idx_aipg_created_at').on(table.createdAt),
  ],
)

/**
 * AI policy group membership (S-09.11, T-09.11.03).
 *
 * Join table between {@link aiPolicyGroups} and {@link aiPolicies}: one
 * row per (group, policy) pair. The composite PK doubles as the lookup
 * index for "policies of group X"; `idx_aipgm_policy_id` covers the
 * reverse query — "which groups contain policy Y" (policy detail view).
 *
 * Deleting either side cascades to the membership row; a policy can belong
 * to several groups and a group can collect several policies.
 */
export const aiPolicyGroupMembers = pgTable(
  'ai_policy_group_members',
  {
    /** Owning group (UUID PK of ai_policy_groups). */
    groupId: uuid('group_id')
      .notNull()
      .references(() => aiPolicyGroups.id, { onDelete: 'cascade' }),

    /** Member policy (UUID PK of ai_policies). */
    policyId: uuid('policy_id')
      .notNull()
      .references(() => aiPolicies.id, { onDelete: 'cascade' }),

    /** When the member was linked into the group. */
    createdAt: timestamptz('created_at').defaultNow().notNull(),
  },
  (table) => [
    /** Composite PK: a policy is a group member exactly once (migration 0044). */
    primaryKey({ columns: [table.groupId, table.policyId] }),
    /** Reverse lookup: which groups contain a given policy. */
    index('idx_aipgm_policy_id').on(table.policyId),
  ],
)
