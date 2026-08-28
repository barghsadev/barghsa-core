import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { aiAgents } from './ai-agents.js'
import { aiAgentKbs, aiAgentPolicies } from './ai-agents.js'

/**
 * Drift guard for the AI agent tables (T-09.11.04).
 *
 * The CHECK constraint (non-empty title), the FK rules (model RESTRICT,
 * KB/policy link CASCADE), and the plain (non-unique) list indexes for
 * these tables live in migration 0045 (Drizzle v0.40's column builder has
 * no `.check()`). This test asserts the migration still declares them and
 * that the drizzle schema columns match the service layer's expectations.
 * If a future `drizzle-kit generate` ever rewrites the migration and drops
 * a constraint, this test fails instead of silently loosening the AI
 * agent posture (owner FK, model reference, per-agent link dedupe).
 */
const MIGRATION = readFileSync(
  join(process.cwd(), 'drizzle', '0045_create_ai_agents.sql'),
  'utf8',
)

/** All three tables must be created by migration 0045. */
const TABLES = ['ai_agents', 'ai_agent_kbs', 'ai_agent_policies'] as const

describe.each(TABLES)('0045 creates %s', (table) => {
  it(`declares CREATE TABLE for ${table}`, () => {
    expect(MIGRATION).toMatch(new RegExp(`CREATE TABLE IF NOT EXISTS ${table}`))
  })
})

describe('AI agent schema (T-09.11.04)', () => {
  it('declares the domain columns expected by the service layer', () => {
    const agentColumns = Object.keys(aiAgents)
    for (const column of ['id', 'title', 'description', 'modelId', 'enabled', 'createdBy', 'createdAt', 'updatedAt']) {
      expect(agentColumns).toContain(column)
    }
    const kbColumns = Object.keys(aiAgentKbs)
    for (const column of ['agentId', 'kbId']) {
      expect(kbColumns).toContain(column)
    }
    const policyColumns = Object.keys(aiAgentPolicies)
    for (const column of ['agentId', 'policyId']) {
      expect(policyColumns).toContain(column)
    }
  })

  it('migration 0045 keeps the agent title CHECK constraint', () => {
    expect(MIGRATION).toMatch(/chk_aia_title[\s\S]*CHECK \(title <> ''\)/)
  })

  it('migration 0045 keeps the model owner FK (UUID ai_models.id, RESTRICT)', () => {
    // ai_models.id is UUID, so model_id is UUID — pin the type and the
    // RESTRICT action so an agent can never silently lose its model.
    expect(MIGRATION).toMatch(
      /model_id\s+UUID NOT NULL REFERENCES ai_models\(id\) ON DELETE RESTRICT/,
    )
  })

  it('migration 0045 keeps the created_by owner FK (TEXT users.user_id, RESTRICT)', () => {
    expect(
      MIGRATION,
    ).toMatch(/created_by\s+TEXT NOT NULL REFERENCES users\(user_id\) ON DELETE RESTRICT/)
  })

  it('migration 0045 keeps the link FK CASCADE on agent/KB/policy delete', () => {
    expect(MIGRATION).toMatch(/agent_id\s+UUID NOT NULL REFERENCES ai_agents\(id\) ON DELETE CASCADE/)
    expect(MIGRATION).toMatch(/kb_id\s+UUID NOT NULL REFERENCES knowledge_bases\(id\) ON DELETE CASCADE/)
    expect(MIGRATION).toMatch(/policy_id\s+UUID NOT NULL REFERENCES ai_policies\(id\) ON DELETE CASCADE/)
  })

  it('migration 0045 creates the title CHECK constraint idempotently (guarded)', () => {
    // Same guarded DO-block pattern as migration 0044 for re-runnability.
    expect(MIGRATION).toMatch(
      /IF NOT EXISTS \(SELECT 1 FROM pg_constraint WHERE conname = 'chk_aia_title'\)/,
    )
  })

  it('migration 0045 keeps the link composite PKs', () => {
    expect(MIGRATION).toMatch(/PRIMARY KEY \(agent_id, kb_id\)/)
    expect(MIGRATION).toMatch(/PRIMARY KEY \(agent_id, policy_id\)/)
  })

  it('migration 0045 keeps the recency/model/list indexes (non-unique)', () => {
    expect(MIGRATION).toMatch(/idx_aia_created_at[\s\S]*ON ai_agents \(created_at DESC\)/)
    expect(MIGRATION).toMatch(/idx_aia_model_id[\s\S]*ON ai_agents \(model_id\)/)
    expect(MIGRATION).toMatch(/idx_aiak_agent_id[\s\S]*ON ai_agent_kbs \(agent_id\)/)
    expect(MIGRATION).toMatch(/idx_aiap_agent_id[\s\S]*ON ai_agent_policies \(agent_id\)/)
  })

  it('migration 0045 keeps the updated_at trigger', () => {
    expect(MIGRATION).toMatch(/trg_aia_updated_at[\s\S]*BEFORE UPDATE ON ai_agents/)
  })

  it('drizzle schema declares UUID FK columns matching migration 0045', () => {
    const columns = [
      aiAgentKbs['agentId'],
      aiAgentKbs['kbId'],
      aiAgentPolicies['agentId'],
      aiAgentPolicies['policyId'],
    ] as Array<{ getSQLType: () => string }>
    for (const column of columns) {
      expect(column.getSQLType()).toBe('uuid')
    }
  })
})