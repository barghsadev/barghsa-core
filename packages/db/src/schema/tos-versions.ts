import { boolean, pgTable, text } from 'drizzle-orm/pg-core'
import { uuidv7, timestamptz } from '../types.js'
import { users } from './users.js'

/**
 * TOS versions table (T-04.01.01, T-04.01.02, T-09.03.01).
 *
 * Stores versioned Terms of Service content in both Persian and English.
 * Only one version is active at a time. The active version is returned by
 * `GET /api/tos/current` and must be accepted during registration and
 * re-acceptance flows.
 *
 * T-09.03.01 (TOS editor) extends this table with:
 * - `change_type` — marks each published version as `major` (material change
 *   → triggers re-acceptance) or `minor` (typo/clarification → no re-acceptance).
 * - `status` — controls the draft → published lifecycle.
 * - `created_by` — records the last editor for audit.
 *
 * - `id` — UUIDv7 primary key, opaque.
 * - `version_id` — human-readable version identifier, e.g. "v1".
 * - `content_fa` — Persian (primary) TOS content, rendered as Markdown.
 * - `content_en` — English TOS content, rendered as Markdown.
 * - `change_type` — `major` (triggers re-acceptance) or `minor`.
 * - `status` — `draft` | `published`.
 * - `created_by` — FK to users (last editor).
 * - `is_active` — exactly one published version may be active at any time.
 * - `published_at` — when this version was published.
 * - `created_at` / `updated_at` — audit columns.
 */
export const tosVersions = pgTable(
  'tos_versions',
  {
    /** UUIDv7 opaque version identifier. */
    id: uuidv7('id').primaryKey().notNull(),

    /** Human-readable version label, e.g. "v1". */
    versionId: text('version_id').notNull().unique(),

    /** Persian (primary) TOS content. */
    contentFa: text('content_fa').notNull(),

    /** English TOS content. */
    contentEn: text('content_en').notNull(),

    /**
     * Change type: `major` (material change → re-acceptance) or
     * `minor` (typo/clarification → no re-acceptance).
     * Only meaningful for published versions.
     */
    changeType: text('change_type', { enum: ['major', 'minor'] })
      .notNull()
      .default('minor'),

    /**
     * Lifecycle status: `draft` (editable, not visible to users)
     * or `published` (final, may be set as active).
     */
    status: text('status', { enum: ['draft', 'published'] })
      .notNull()
      .default('draft'),

    /** FK to users — the last editor of this version. */
    createdBy: text('created_by')
      .references(() => users.userId, { onDelete: 'set null' }),

    /** Whether this version is the currently active one. */
    isActive: boolean('is_active').notNull().default(false),

    /** When this version was published (null while in draft). */
    publishedAt: timestamptz('published_at'),

    /** Record creation timestamp. */
    createdAt: timestamptz('created_at').defaultNow().notNull(),

    /** Record last-updated timestamp. */
    updatedAt: timestamptz('updated_at')
      .defaultNow()
      .notNull()
      .$onUpdate(() => new Date()),
  },
)