import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { aiModels } from './ai-models.js'

/**
 * Drift guard for the ai_models table (T-09.11.01).
 *
 * The CHECK constraints and plain (non-unique) list index for this table live
 * in migration 0042 (Drizzle v0.40's column builder has no `.check()`). This
 * test asserts the migration still declares them and that the drizzle schema
 * columns match the service layer's expectations. If a future
 * `drizzle-kit generate` ever rewrites the migration and drops a constraint,
 * this test fails instead of silently loosening the AI model security
 * posture (encrypted token column, fail-closed test status values).
 */
const MIGRATION = readFileSync(
  join(process.cwd(), 'drizzle', '0042_create_ai_models.sql'),
  'utf8',
)

describe('ai_models schema (T-09.11.01)', () => {
  it('declares the domain columns expected by the service layer', () => {
    const columns = Object.keys(aiModels)
    for (const column of [
      'id',
      'title',
      'providerType',
      'baseUrl',
      'modelName',
      'apiToken',
      'createdBy',
      'lastTestedAt',
      'lastTestStatus',
      'lastTestError',
    ]) {
      expect(columns).toContain(column)
    }
  })

  it('migration 0042 keeps the provider_type CHECK constraint', () => {
    expect(MIGRATION).toMatch(
      /chk_aim_provider_type[\s\S]*CHECK \(provider_type IN \('openai_compatible', 'anthropic'\)\)/,
    )
  })

  it('migration 0042 keeps the test-status CHECK constraint', () => {
    expect(MIGRATION).toMatch(
      /chk_aim_last_test_status[\s\S]*CHECK \(last_test_status IN \('pending', 'passed', 'failed'\)\)/,
    )
  })

  it('migration 0042 keeps the non-empty fields CHECK constraint', () => {
    expect(MIGRATION).toMatch(
      /chk_aim_non_empty_fields[\s\S]*CHECK \(title <> '' AND base_url <> '' AND model_name <> ''\)/,
    )
  })

  it('migration 0042 keeps the recency list index (non-unique)', () => {
    expect(MIGRATION).toMatch(
      /idx_aim_created_at[\s\S]*ON ai_models \(created_at DESC\)/,
    )
  })

  it('migration 0042 keeps the updated_at trigger', () => {
    expect(MIGRATION).toMatch(/trg_aim_updated_at[\s\S]*BEFORE UPDATE ON ai_models/)
  })
})