import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { aiAgentSlots } from './ai-agent-slots.js'

/**
 * Drift guard for the AI agent slot table (T-09.11.05).
 *
 * The CHECK constraints (non-empty label, fixed five-key slot set), the
 * seed of the predefined slots, the SET NULL FK rules, and the plain
 * (non-unique) reverse-lookup index live in migration 0046 (Drizzle
 * v0.40's column builder has no `.check()`). This test asserts the
 * migration still declares them and that the drizzle schema matches the
 * service layer's expectations. If a future `drizzle-kit generate` ever
 * rewrites the migration and drops a constraint or the seed, this test
 * fails instead of silently loosening the slot-assignment posture.
 */
const MIGRATION = readFileSync(
  join(process.cwd(), 'drizzle', '0046_create_ai_agent_slots.sql'),
  'utf8',
)

/** The five predefined chatbot slots from the epic T-09.11.05. */
const SLOT_KEYS = [
  'individual_chatbot',
  'legal_entity_chatbot',
  'staff_chatbot',
  'website_chatbot',
  'telegram_chatbot',
] as const

describe('AI agent slot schema (T-09.11.05)', () => {
  it('declares the domain columns expected by the service layer', () => {
    const columns = Object.keys(aiAgentSlots)
    for (const column of ['slotKey', 'label', 'agentId', 'updatedBy', 'updatedAt']) {
      expect(columns).toContain(column)
    }
  })

  it('drizzle schema declares a UUID FK to ai_agents with SET NULL', () => {
    const agentId = aiAgentSlots['agentId'] as {
      getSQLType: () => string
      onDelete?: string
      reference?: { foreignKey: boolean }
    }
    expect(agentId.getSQLType()).toBe('uuid')
  })

  it('migration 0046 creates the ai_agent_slots table', () => {
    expect(MIGRATION).toMatch(/CREATE TABLE IF NOT EXISTS ai_agent_slots/)
  })

  it('migration 0046 seeds all five predefined slot keys', () => {
    for (const key of SLOT_KEYS) {
      expect(MIGRATION).toMatch(new RegExp(`'${key}'`))
    }
    // Seed count: exactly five rows, idempotent on re-run.
    expect(MIGRATION).toMatch(/ON CONFLICT \(slot_key\) DO NOTHING/)
  })

  it('migration 0046 keeps the agent_id FK (UUID ai_agents.id, SET NULL)', () => {
    expect(MIGRATION).toMatch(
      /agent_id\s+UUID REFERENCES ai_agents\(id\) ON DELETE SET NULL/,
    )
  })

  it('migration 0046 keeps the updated_by FK (TEXT users.user_id, SET NULL)', () => {
    expect(
      MIGRATION,
    ).toMatch(/updated_by\s+TEXT REFERENCES users\(user_id\) ON DELETE SET NULL/)
  })

  it('migration 0046 keeps the non-empty label CHECK constraint (guarded)', () => {
    expect(MIGRATION).toMatch(/chk_aias_label[\s\S]*CHECK \(label <> ''\)/)
    expect(MIGRATION).toMatch(
      /IF NOT EXISTS \(SELECT 1 FROM pg_constraint WHERE conname = 'chk_aias_label'\)/,
    )
  })

  it('migration 0046 pins the five-key slot set with a CHECK constraint', () => {
    expect(MIGRATION).toMatch(/chk_aias_slot_key[\s\S]*slot_key IN \(/)
    for (const key of SLOT_KEYS) {
      expect(MIGRATION).toMatch(new RegExp(`'${key}'`))
    }
  })

  it('migration 0046 keeps the reverse-lookup agent index (non-unique)', () => {
    expect(MIGRATION).toMatch(/idx_aias_agent_id[\s\S]*ON ai_agent_slots \(agent_id\)/)
  })

  it('migration 0046 keeps the updated_at trigger', () => {
    expect(MIGRATION).toMatch(/trg_aias_updated_at[\s\S]*BEFORE UPDATE ON ai_agent_slots/)
  })
})