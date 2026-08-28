import { pgTable, text, index } from 'drizzle-orm/pg-core'
import { uuidv7, timestamptz } from '../types.js'
import { users } from './users.js'

/**
 * AI model record (S-09.11, T-09.11.01).
 *
 * One row = one configured LLM endpoint the admin can reference from AI
 * agents (T-09.11.04). The row is the durable record behind the admin AI
 * model management surface:
 *
 * - `title` — human-friendly label.
 * - `provider_type` — wire-protocol family: `openai_compatible` (Chat
 *   Completions, `Authorization: Bearer`) or `anthropic` (Messages API,
 *   `x-api-key`). This decides how the connection tester shapes its ping.
 * - `base_url` — provider base URL (admin-configurable, e.g.
 *   `https://api.openai.com/v1`). The tester appends the protocol-specific
 *   path (`/chat/completions` or `/messages`) and SSRF-guards the host.
 * - `model_name` — model identifier sent to the provider.
 * - `api_token` — provider API token, encrypted at rest (AES-256-GCM,
 *   `v1:` format, `AI_MODEL_ENCRYPTION_KEY`). Never returned plaintext by
 *   the API; nullable for token-less local endpoints.
 * - `last_test_status` / `last_tested_at` / `last_test_error` — outcome of
 *   the most recent test-button ping, driving the UI reachable/unreachable
 *   status column.
 *
 * The CHECK constraints on `provider_type`, `last_test_status`, and
 * non-empty `title`/`base_url`/`model_name` live in migration 0042 (Drizzle
 * v0.40's column builder has no `.check()` for these).
 */

export const aiModels = pgTable(
  'ai_models',
  {
    id: uuidv7('id').primaryKey().notNull(),

    /** Human-friendly label shown in the admin UI. */
    title: text('title').notNull(),

    /** Wire-protocol family: 'openai_compatible' | 'anthropic'. */
    providerType: text('provider_type', {
      enum: ['openai_compatible', 'anthropic'],
    } as const).notNull(),

    /** Provider API base URL (admin-configurable; SSRF-guarded on test). */
    baseUrl: text('base_url').notNull(),

    /** Model identifier sent to the provider (e.g. 'gpt-4o'). */
    modelName: text('model_name').notNull(),

    /** Provider API token, encrypted at rest (T-09.11.01). Nullable. */
    apiToken: text('api_token'),

    /** Admin user who created this model. */
    createdBy: text('created_by')
      .notNull()
      .references(() => users.userId, { onDelete: 'restrict' }),

    /** When the most recent connection test ran. */
    lastTestedAt: timestamptz('last_tested_at'),

    /** Outcome of the most recent connection test. */
    lastTestStatus: text('last_test_status', {
      enum: ['pending', 'passed', 'failed'],
    } as const)
      .notNull()
      .default('pending'),

    /** Safe, non-secret error from the most recent failed test. */
    lastTestError: text('last_test_error'),

    createdAt: timestamptz('created_at').defaultNow().notNull(),
    updatedAt: timestamptz('updated_at')
      .defaultNow()
      .notNull()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    /** List by recency for the admin UI (migration 0042). */
    index('idx_aim_created_at').on(table.createdAt),
  ],
)