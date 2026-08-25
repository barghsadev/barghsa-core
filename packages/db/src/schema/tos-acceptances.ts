import { pgTable, text } from 'drizzle-orm/pg-core'
import { uuidv7, timestamptz } from '../types.js'
import { tosVersions } from './tos-versions.js'
import { users } from './users.js'

/**
 * TOS acceptances table (T-04.01.02).
 *
 * Records each TOS acceptance — both the initial registration acceptance
 * and any subsequent re-acceptance — as an immutable legal record.
 *
 * Each entry captures:
 * - Which version was accepted (references tos_versions)
 * - Which user accepted it (references users)
 * - When it was accepted
 * - The IP address and user-agent at acceptance time
 *
 * Rows are append-only — no updates, no deletes. Acceptance is legally
 * significant and must be preserved unchanged for audit purposes.
 */
export const tosAcceptances = pgTable(
  'tos_acceptances',
  {
    /** UUIDv7 opaque acceptance identifier. */
    id: uuidv7('id').primaryKey().notNull(),

    /** The user who accepted the TOS. */
    userId: text('user_id')
      .notNull()
      .references(() => users.userId, { onDelete: 'restrict' }),

    /** The TOS version that was accepted. */
    versionId: text('version_id')
      .notNull()
      .references(() => tosVersions.id, { onDelete: 'restrict' }),

    /** When the acceptance occurred. */
    acceptedAt: timestamptz('accepted_at').defaultNow().notNull(),

    /** Source IP address at acceptance time. */
    ipAddress: text('ip_address'),

    /** User-Agent header from the device/browser at acceptance time. */
    userAgent: text('user_agent'),
  },
)