import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { backgroundJobs } from './background-jobs.js'

/**
 * Drift guard for the background_jobs table (T-09.09.02).
 *
 * The CHECK constraints and indexes for this table live in migration 0041
 * (Drizzle v0.40's column builder has no `.check()`), so this test asserts
 * the migration still declares them and the composite list index. If a
 * future `drizzle-kit generate` ever rewrites the migration and drops a
 * constraint, this test fails instead of silently loosening the job
 * triage control.
 */
const MIGRATION = readFileSync(
  join(process.cwd(), 'drizzle', '0041_create_background_jobs.sql'),
  'utf8',
)

describe('background_jobs schema (T-09.09.02)', () => {
  it('declares the domain columns expected by the service layer', () => {
    const columns = Object.keys(backgroundJobs)
    for (const column of [
      'jobType',
      'status',
      'error',
      'errorCategory',
      'attempts',
      'maxAttempts',
      'payload',
      'firstFailedAt',
      'lastRunAt',
      'nextRunAt',
      'resolvedById',
      'resolvedAt',
    ]) {
      expect(columns).toContain(column)
    }
  })

  it('migration 0041 keeps the status CHECK constraint', () => {
    expect(MIGRATION).toMatch(
      /chk_bj_status[\s\S]*CHECK \(status IN \('failed', 'retrying', 'dead_letter', 'resolved'\)\)/,
    )
  })

  it('migration 0041 keeps the error-category CHECK constraint', () => {
    expect(MIGRATION).toMatch(
      /chk_bj_error_category[\s\S]*CHECK \(error_category IN \('transient', 'permanent', 'provider'\)\)/,
    )
  })

  it('migration 0041 keeps the attempts guard constraints', () => {
    expect(MIGRATION).toMatch(/chk_bj_attempts_ge_1[\s\S]*CHECK \(attempts >= 1\)/)
    expect(MIGRATION).toMatch(/chk_bj_max_attempts_ge_1[\s\S]*CHECK \(max_attempts >= 1\)/)
  })

  it('migration 0041 keeps the composite list index', () => {
    expect(MIGRATION).toMatch(
      /idx_background_jobs_status_first_failed_at[\s\S]*ON background_jobs \(status, first_failed_at DESC\)/,
    )
  })

  it('migration 0041 keeps the unique-active-per-type partial index', () => {
    expect(MIGRATION).toMatch(
      /uq_background_jobs_active_per_type[\s\S]*ON background_jobs \(job_type\)\s+WHERE status IN \('failed', 'retrying', 'dead_letter'\)/,
    )
  })
})
