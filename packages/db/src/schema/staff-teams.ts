import {
  text,
  boolean,
  jsonb,
  uuid,
  pgTable,
  timestamp,
  primaryKey,
  check,
  unique,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { baseColumns } from '../base-table.js';
import { users } from './users.js';

/**
 * Staff teams (S-09.08, T-09.08.02).
 *
 * One row per admin-configured staff team. Teams group staff members
 * (through {@link staffTeamMembers}) and optionally carry skill tags, which
 * the API assignment engine uses to implement the
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
 * Team-name and membership constraints are declared here and restored for
 * production upgrades by migration 0103. Optional team leads receive escalation alerts.
 *
 * @module db/schema
 */
export const staffTeams = pgTable(
  'staff_teams',
  {
    ...baseColumns,
    leadUserId: text('lead_user_id').references(() => users.userId, { onDelete: 'set null' }),
    /** Display name, unique across teams. */
    name: text('name').notNull(),

    /** Free-form description (nullable). */
    description: text('description'),

    /** Skill tags used by expertise/load assignment (JSONB array of text). */
    skillTags: jsonb('skill_tags').$type<string[]>().notNull().default([]),

    /** Soft-disable flag; disabled teams are never auto-assigned. */
    isActive: boolean('is_active').notNull().default(true),
  },
  (table) => [
    unique('uq_st_name').on(table.name),
    check('chk_st_name_length', sql`char_length(${table.name}) BETWEEN 1 AND 80`),
  ]
);

/**
 * Staff team membership (S-09.08, T-09.08.02).
 *
 * Join table between {@link staffTeams} and `users`. One row per member.
 * The UNIQUE (team_id, user_id) constraint prevents duplicate membership
 * and doubles as the lookup index for "members of team X".
 *
 * The schema and production migration retain the membership uniqueness rule.
 */
export const staffTeamMembers = pgTable(
  'staff_team_members',
  {
    ...baseColumns,
    /** Owning team (UUID PK of staff_teams). */
    teamId: uuid('team_id')
      .notNull()
      .references(() => staffTeams.id, { onDelete: 'cascade' }),

    /** Member user. */
    userId: text('user_id')
      .notNull()
      .references(() => users.userId, { onDelete: 'cascade' }),
  },
  (table) => [unique('uq_stm_team_member').on(table.teamId, table.userId)]
);

/** Durable round-robin position, committed with the new work item. */
export const staffAssignmentCursors = pgTable(
  'staff_assignment_cursors',
  {
    teamId: uuid('team_id')
      .notNull()
      .references(() => staffTeams.id, { onDelete: 'cascade' }),
    workType: text('work_type').notNull(),
    lastUserId: text('last_user_id').references(() => users.userId, { onDelete: 'set null' }),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  },
  (table) => [
    primaryKey({ columns: [table.teamId, table.workType] }),
    check(
      'staff_assignment_cursors_work_type_check',
      sql`${table.workType} IN ('ticket','verification_case')`
    ),
  ]
);
