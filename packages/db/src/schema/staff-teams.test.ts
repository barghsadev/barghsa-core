import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { staffTeams, staffTeamMembers } from './staff-teams.js'

/**
 * Drift guard for the staff_teams / staff_team_members tables (T-09.08.02).
 *
 * The CHECK / UNIQUE / FK constraints for these tables live in migration
 * 0038 (Drizzle v0.40's column builder has no `.check()`), so this test
 * asserts the migration still declares them, the base columns (`created_at`,
 * `updated_at`) match the `createTable` contract used by the drizzle schema,
 * and that membership cleanup semantics (team/user cascade) are pinned. If a
 * future `drizzle-kit generate` ever rewrites the migration and drops a
 * constraint, this test fails instead of silently allowing duplicate team
 * names or orphaned memberships.
 */
const MIGRATION = readFileSync(
  join(process.cwd(), 'drizzle', '0038_create_staff_teams.sql'),
  'utf8',
)

describe('staff_teams schema (T-09.08.02)', () => {
  it('declares the domain columns expected by the admin CRUD', () => {
    const columns = Object.keys(staffTeams)
    for (const column of ['name', 'description', 'skillTags', 'isActive']) {
      expect(columns).toContain(column)
    }
  })

  it('declares the createTable base columns (id, created_at, updated_at)', () => {
    for (const table of [staffTeams, staffTeamMembers]) {
      const columns = Object.keys(table)
      for (const column of ['id', 'createdAt', 'updatedAt']) {
        expect(columns).toContain(column)
      }
    }
    // The migration must create the same base columns the drizzle schema
    // (createTable) exposes, or a future ORM query would hit missing columns.
    expect(MIGRATION).toMatch(/id\s+UUID PRIMARY KEY DEFAULT uuid_generate_v7\(\)/)
    expect(MIGRATION).toMatch(/created_at\s+TIMESTAMPTZ NOT NULL DEFAULT NOW\(\)/)
    expect(MIGRATION).toMatch(/updated_at\s+TIMESTAMPTZ NOT NULL DEFAULT NOW\(\)/)
  })

  it('migration 0038 keeps the unique team-name constraint', () => {
    expect(MIGRATION).toMatch(/uq_st_name[\s\S]*UNIQUE \(name\)/)
  })

  it('migration 0038 keeps the name length CHECK constraint', () => {
    expect(MIGRATION).toMatch(/chk_st_name_length[\s\S]*CHECK \(char_length\(name\) BETWEEN 1 AND 80\)/)
  })

  it('migration 0038 pins cascade cleanup for team membership', () => {
    expect(MIGRATION).toMatch(/fk_stm_team[\s\S]*REFERENCES staff_teams\(id\) ON DELETE CASCADE/)
    expect(MIGRATION).toMatch(/fk_stm_user[\s\S]*REFERENCES users\(user_id\) ON DELETE CASCADE/)
  })

  it('migration 0038 prevents duplicate membership', () => {
    expect(MIGRATION).toMatch(/uq_stm_team_member[\s\S]*UNIQUE \(team_id, user_id\)/)
  })

  it('migration 0038 indexes user_id for member-of lookups', () => {
    expect(MIGRATION).toMatch(/CREATE INDEX IF NOT EXISTS idx_stm_user ON staff_team_members \(user_id\)/)
  })
})
