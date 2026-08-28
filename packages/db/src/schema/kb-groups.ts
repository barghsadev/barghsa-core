import { index, pgTable, text } from 'drizzle-orm/pg-core'
import { uuidv7, timestamptz } from '../types.js'
import { users } from './users.js'
import { knowledgeBases } from './knowledge-bases.js'

/**
 * Knowledge base group (S-09.11, T-09.11.02).
 *
 * One row = one KB group, a named collection of knowledge bases (see
 * {@link kbGroupMembers}). Groups let an AI agent (T-09.11.04) retrieve
 * across several curated KBs without enumerating them individually.
 *
 * Row layout:
 * - `title`        human-friendly label
 * - `description`  free-text notes
 * - `created_by`   admin user who created the group
 *
 * The CHECK constraint on non-empty `title` and the `updated_at` trigger
 * live in migration 0043; `knowledge-bases.test.ts` pins them.
 */
export const kbGroups = pgTable(
  'kb_groups',
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
    /** List by recency for the admin UI (migration 0043). */
    index('idx_kbg_created_at').on(table.createdAt),
  ],
)

/**
 * KB group membership (S-09.11, T-09.11.02).
 *
 * Join table between {@link kbGroups} and {@link knowledgeBases}: one row
 * per (group, KB) pair. The composite PK doubles as the lookup index for
 * "member KBs of group X"; `idx_kbgm_kb_id` covers the reverse query —
 * "which groups contain KB Y" (shown on the KB detail view).
 *
 * Deleting either side cascades to the membership row; a KB can belong to
 * several groups and a group can collect several KBs.
 */
export const kbGroupMembers = pgTable(
  'kb_group_members',
  {
    /** Owning group (UUID PK of kb_groups). */
    groupId: text('group_id')
      .notNull()
      .references(() => kbGroups.id, { onDelete: 'cascade' }),

    /** Member KB (UUID PK of knowledge_bases). */
    kbId: text('kb_id')
      .notNull()
      .references(() => knowledgeBases.id, { onDelete: 'cascade' }),

    /** When the member was linked into the group. */
    createdAt: timestamptz('created_at').defaultNow().notNull(),
  },
  (table) => [
    /** Reverse lookup: which groups contain a given KB. */
    index('idx_kbgm_kb_id').on(table.kbId),
  ],
)

// The composite primary key (group_id, kb_id) is declared in migration
// 0043 via the table definition; Drizzle's pgTable would generate
// `primaryKey({ columns: [groupId, kbId] })` on db push, which matches.
export { kbGroups as kbGroupsTable }