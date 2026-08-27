import { jsonb, pgTable, text, uniqueIndex } from 'drizzle-orm/pg-core'
import { sql } from 'drizzle-orm'
import { uuidv7, timestamptz } from '../types.js'
import { users } from './users.js'

/**
 * Email provider configuration (E-05, T-05.06.01).
 *
 * A single row represents one version of an email delivery provider
 * configuration (SMTP or Resend). The row is the durable record behind the
 * provider administration lifecycle: drafts are created and edited, a passing
 * test promotes a draft to the single Active configuration for the channel,
 * and activation supersedes any previous Active version (which becomes
 * SUPERSEDED and is preserved for rollback). An Active configuration can be
 * disabled by an admin action.
 *
 * Lifecycle (`status`):
 * - `draft`      — freshly created or edited; the only editable state.
 * - `active`     — at most one per environment per channel; the configuration
 *                  currently used for email delivery. Reached only after a
 *                  passing test (`last_test_status = 'passed'`).
 * - `superseded` — a previous `active` that was replaced when a new config
 *                  was activated. Read-only but preserved for rollback.
 * - `disabled`   — an admin-deactivated configuration (previously active or a
 *                  never-activated draft/config).
 *
 * Activating a new config automatically supersedes the current active one
 * (recorded via `supersedes_id`). Disabling the sole `active` configuration
 * for the OTP email channel is blocked to guarantee an out-of-band recovery
 * path always exists (see {@link EmailProviderConfigService}).
 *
 * Secrets (e.g. SMTP password / Resend API key) are stored encrypted in the
 * `config` JSONB blob at field level (T-05.06.05) and are never returned in
 * plaintext by the API. The column itself is opaque to this module.
 */

export const emailProviderConfigs = pgTable(
  'email_provider_configs',
  {
    id: uuidv7('id').primaryKey().notNull(),

    /** Transport backend: 'smtp' or 'resend'. Immutable after creation. */
    transport: text('transport', {
      enum: ['smtp', 'resend'],
    } as const).notNull(),

    /** Human-friendly label shown in the admin UI (e.g. 'Production Resend'). */
    label: text('label').notNull(),

    /** Lifecycle status (T-05.06.01 state machine). */
    status: text('status', {
      enum: ['draft', 'active', 'superseded', 'disabled'],
    } as const)
      .notNull()
      .default('draft'),

    /**
     * Transport-specific configuration (SMTP vs Resend fields), encrypted at
     * rest at field level (T-05.06.05). Opaque JSONB here.
     */
    config: jsonb('config').notNull(),

    /** Admin user who created this configuration. */
    createdBy: text('created_by')
      .notNull()
      .references(() => users.userId, { onDelete: 'restrict' }),

    /** When this configuration was promoted to `active`. */
    activatedAt: timestamptz('activated_at'),

    /** Admin user who activated (or rolled back to) this configuration. */
    activatedBy: text('activated_by').references(() => users.userId, { onDelete: 'restrict' }),

    /** When the most recent test message was sent. */
    lastTestAt: timestamptz('last_test_at'),

    /** Outcome of the most recent test-send attempt. */
    lastTestStatus: text('last_test_status', {
      enum: ['pending', 'passed', 'failed'],
    } as const)
      .notNull()
      .default('pending'),

    /** Safe, non-secret error from the most recent failed test-send. */
    lastTestError: text('last_test_error'),

    /**
     * The `active` configuration this one replaced (set when this config is
     * the promo that superseded a prior active). Null for drafts and the
     * first active config. FK constraint to this table (`id`) is declared in
     * the SQL migration (0031) — a Drizzle-level self-reference is omitted to
     * avoid circular-type inference on the table initializer.
     */
    supersedesId: uuidv7('supersedes_id'),

    createdAt: timestamptz('created_at').defaultNow().notNull(),
    updatedAt: timestamptz('updated_at')
      .defaultNow()
      .notNull()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    /**
     * Database-level guard for "at most one Active provider per environment"
     * (T-05.06.01). A partial unique index over rows whose status is `active`
     * — only one row may ever hold the active state. The service enforces the
     * same rule transactionally for a friendlier, domain-specific error.
     */
    uniqueIndex('uq_email_provider_active').on(table.status).where(sql`status = 'active'`),
  ],
)