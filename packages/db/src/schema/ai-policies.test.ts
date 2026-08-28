import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { aiPolicies } from './ai-policies.js'
import { aiPolicyGroups, aiPolicyGroupMembers } from './ai-policy-groups.js'

/**
 * Drift guard for the AI policy tables (T-09.11.03).
 *
 * The CHECK constraints (non-empty title, policy_type), the FK cascade
 * rules, and the plain (non-unique) list/type indexes for these tables
 * live in migration 0044 (Drizzle v0.40's column builder has no
 * `.check()`). This test asserts the migration still declares them and
 * that the drizzle schema columns match the service layer's expectations.
 * If a future `drizzle-kit generate` ever rewrites the migration and drops
 * a constraint, this test fails instead of silently loosening the AI
 * guardrail posture (owner FK, supported policy types, per-group dedupe).
 */
const MIGRATION = readFileSync(
  join(process.cwd(), 'drizzle', '0044_create_ai_policies.sql'),
  'utf8',
)

/** All three tables must be created by migration 0044. */
const TABLES = [
  'ai_policies',
  'ai_policy_groups',
  'ai_policy_group_members',
] as const

describe.each(TABLES)('0044 creates %s', (table) => {
  it(`declares CREATE TABLE for ${table}`, () => {
    expect(MIGRATION).toMatch(new RegExp(`CREATE TABLE IF NOT EXISTS ${table}`))
  })
})

describe('AI policy schema (T-09.11.03)', () => {
  it('declares the domain columns expected by the service layer', () => {
    const policyColumns = Object.keys(aiPolicies)
    for (const column of [
      'id',
      'title',
      'description',
      'policyType',
      'rules',
      'enabled',
      'createdBy',
      'createdAt',
      'updatedAt',
    ]) {
      expect(policyColumns).toContain(column)
    }
    const groupColumns = Object.keys(aiPolicyGroups)
    for (const column of ['id', 'title', 'description', 'createdBy']) {
      expect(groupColumns).toContain(column)
    }
    const memberColumns = Object.keys(aiPolicyGroupMembers)
    for (const column of ['groupId', 'policyId']) {
      expect(memberColumns).toContain(column)
    }
  })

  it('migration 0044 keeps the policy title CHECK constraint', () => {
    expect(MIGRATION).toMatch(/chk_aip_title[\s\S]*CHECK \(title <> ''\)/)
  })

  it('migration 0044 keeps the policy group title CHECK constraint', () => {
    expect(MIGRATION).toMatch(/chk_aipg_title[\s\S]*CHECK \(title <> ''\)/)
  })

  it('migration 0044 keeps the supported policy-type CHECK constraint', () => {
    expect(MIGRATION).toMatch(
      /chk_aip_type[\s\S]*CHECK \(policy_type IN \('allowed_topics', 'disallowed_actions', 'data_access_scope', 'response_style'\)\)/,
    )
  })

  it('drizzle schema declares UUID FK columns matching migration 0044', () => {
    // ai_policy_group_members.group_id/policy_id must be UUID-typed in the
    // schema so db:push produces the same columns as the migration.
    const columns = [
      aiPolicyGroupMembers['groupId'],
      aiPolicyGroupMembers['policyId'],
    ] as Array<{ getSQLType: () => string }>
    for (const column of columns) {
      const sqlType = column.getSQLType()
      // drizzle uuid() reports the TS data type as 'string' but the emitted
      // SQL column type is 'uuid'.
      expect(sqlType).toBe('uuid')
    }
  })

  it('migration 0044 keeps the membership FK cascade on policy/group delete', () => {
    expect(MIGRATION).toMatch(/group_id\s+UUID NOT NULL REFERENCES ai_policy_groups\(id\) ON DELETE CASCADE/)
    expect(MIGRATION).toMatch(/policy_id\s+UUID NOT NULL REFERENCES ai_policies\(id\) ON DELETE CASCADE/)
  })

  it('migration 0044 keeps the membership composite PK', () => {
    expect(MIGRATION).toMatch(/PRIMARY KEY \(group_id, policy_id\)/)
  })

  it('migration 0044 keeps the recency/type list indexes (non-unique)', () => {
    expect(MIGRATION).toMatch(/idx_aip_created_at[\s\S]*ON ai_policies \(created_at DESC\)/)
    expect(MIGRATION).toMatch(/idx_aip_type[\s\S]*ON ai_policies \(policy_type\)/)
    expect(MIGRATION).toMatch(/idx_aipg_created_at[\s\S]*ON ai_policy_groups \(created_at DESC\)/)
  })

  it('migration 0044 keeps the reverse membership index (non-unique)', () => {
    expect(MIGRATION).toMatch(/idx_aipgm_policy_id[\s\S]*ON ai_policy_group_members \(policy_id\)/)
  })

  it('migration 0044 keeps the updated_at triggers', () => {
    expect(MIGRATION).toMatch(/trg_aip_updated_at[\s\S]*BEFORE UPDATE ON ai_policies/)
    expect(MIGRATION).toMatch(/trg_aipg_updated_at[\s\S]*BEFORE UPDATE ON ai_policy_groups/)
  })
})