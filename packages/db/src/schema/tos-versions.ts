import { boolean, pgTable, text } from 'drizzle-orm/pg-core'
import { uuidv7, timestamptz } from '../types.js'

/**
 * TOS versions table (T-04.01.01, T-04.01.02).
 *
 * Stores versioned Terms of Service content in both Persian and English.
 * Only one version is active at a time. The active version is returned by
 * `GET /api/tos/current` and must be accepted during registration and
 * re-acceptance flows.
 *
 * - `id` — UUIDv7 primary key, opaque.
 * - `version_id` — human-readable version identifier, e.g. "v1".
 * - `content_fa` — Persian (primary) TOS content, rendered as Markdown.
 * - `content_en` — English TOS content, rendered as Markdown.
 * - `is_active` — exactly one version is active at any time.
 * - `published_at` — when this version was published (may differ from created_at).
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

    /** Whether this version is the currently active one. */
    isActive: boolean('is_active').notNull().default(false),

    /** When this version was published. */
    publishedAt: timestamptz('published_at').notNull(),

    /** Record creation timestamp. */
    createdAt: timestamptz('created_at').defaultNow().notNull(),

    /** Record last-updated timestamp. */
    updatedAt: timestamptz('updated_at')
      .defaultNow()
      .notNull()
      .$onUpdate(() => new Date()),
  },
)