import { index, jsonb, pgTable, text, boolean } from 'drizzle-orm/pg-core'
import { uuidv7, timestamptz } from '../types.js'
import { users } from './users.js'

/**
 * AI usage policy (S-09.11, T-09.11.03).
 *
 * One row = one rule/permission/guardrail an admin defines for AI agents
 * (T-09.11.04). Agents reference policies directly or through policy
 * groups (see ai-policy-groups.ts).
 *
 * Row layout:
 * - `title`        human-friendly label shown in the admin UI
 * - `description`  free-text notes (defaults to '' so the admin API can
 *                  treat it as optional without nullable handling)
 * - `policy_type`  guardrail kind: 'allowed_topics' | 'disallowed_actions'
 *                  | 'data_access_scope' | 'response_style'
 * - `rules`        JSONB document whose shape depends on `policy_type`;
 *                  validated by the API (structured editor) before save
 * - `enabled`      active flag — lets an admin deactivate a policy
 *                  without deleting it
 * - `created_by`   admin user who created the policy
 *
 * The CHECK constraints on non-empty `title`, `policy_type`, and the
 * `updated_at` trigger live in migration 0044 (Drizzle v0.40's column
 * builder has no `.check()`); `ai-policies.test.ts` pins the migration so
 * a future `drizzle-kit generate` cannot silently drop them.
 */
export const aiPolicies = pgTable(
  'ai_policies',
  {
    id: uuidv7('id').primaryKey().notNull(),

    /** Human-friendly label shown in the admin UI. */
    title: text('title').notNull(),

    /** Free-text description of what the policy enforces. */
    description: text('description').notNull().default(''),

    /** Guardrail kind. */
    policyType: text('policy_type', {
      enum: ['allowed_topics', 'disallowed_actions', 'data_access_scope', 'response_style'],
    } as const).notNull(),

    /** Structured guardrail document (validated by type in the API). */
    rules: jsonb('rules').notNull().default({}),

    /** Active/inactive flag for assignment to agents. */
    enabled: boolean('enabled').notNull().default(true),

    /** Admin user who created this policy. */
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
    index('idx_aip_created_at').on(table.createdAt),
    /** Filter policies by guardrail kind (admin list). */
    index('idx_aip_type').on(table.policyType),
  ],
)