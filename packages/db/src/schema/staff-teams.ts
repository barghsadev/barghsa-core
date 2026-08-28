import { text, boolean, jsonb, uuid } from 'drizzle-orm/pg-core'
import { createTable } from '../base-table.js'
import { users } from './users.js'

/**
 * Staff teams (S-09.08, T-09.08.02).
 *
 * One row per admin-configured staff team. Teams group staff members
 * (through {@link staffTeamMembers}) and optionally carry skill tags, which
 * the future worker assignment engine uses to implement the
 * 'expertise'/'load' strategies (T-09.08.02). Assignment rules themselves
 * live in `app_config` under `admin.staff_assignment_rules` (see
 * @barghsa/shared/admin staff-teams.ts), like the other versioned admin
 * configs.
 *
 * Row layout:
 * - `name`          display name, unique (the admin-facing identifier)
 * - `description`   free-form note (nullable)
 * - `skill_tags`    JSONB array of skill tags (text[] in the migration)
 * - `is_active`     soft-disable flag — a disabled team can still exist but
 *                   must never be picked by the assignment engine
 *
 * Database-level CHECK constraints live in migration `0038` only (Drizzle's
 * column builder in v0.40 does not expose `.check()`): `chk_st_name_length`
 * and `chk_st_active_bool` plus the `uq_st_name` unique constraint.
 * `staff-teams.test.ts` pins migration 0038 so a future `drizzle-kit
 * generate` cannot silently drop them.
 *
 * @module db/schema
 */
export const staffTeams = createTable('staff_teams', {
  /** Display name, unique across teams. */
  name: text('name').notNull(),

  /** Free-form description (nullable). */
  description: text('description'),

  /** Skill tags used by expertise/load assignment (JSONB array of text). */
  skillTags: jsonb('skill_tags').$type<string[]>().notNull().default([]),

  /** Soft-disable flag; disabled teams are never auto-assigned. */
  isActive: boolean('is_active').notNull().default(true),
})

/**
 * Staff team membership (S-09.08, T-09.08.02).
 *
 * Join table between {@link staffTeams} and `users`. One row per member.
 * The UNIQUE (team_id, user_id) constraint prevents duplicate membership
 * and doubles as the lookup index for "members of team X".
 *
 * Constraints live in migration `0038` (see {@link staffTeams} header).
 */
export const staffTeamMembers = createTable('staff_team_members', {
  /** Owning team (UUID PK of staff_teams). */
  teamId: uuid('team_id')
    .notNull()
    .references(() => staffTeams.id, { onDelete: 'cascade' }),

  /** Member user. */
  userId: text('user_id')
    .notNull()
    .references(() => users.userId, { onDelete: 'cascade' }),
})
