import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { reconciliationExceptions } from './reconciliation-exceptions.js'

/**
 * Drift guard for the reconciliation_exceptions table (T-09.09.01).
 *
 * The CHECK constraints for this table live in migration 0040 (Drizzle
 * v0.40's column builder has no `.check()`), so this test asserts the
 * migration still declares them and the composite list index. If a future
 * `drizzle-kit generate` ever rewrites the migration and drops a
 * constraint, this test fails instead of silently loosening the
 * reconciliation control.
 */
const MIGRATION = readFileSync(
  join(process.cwd(), 'drizzle', '0040_create_reconciliation_exceptions.sql'),
  'utf8',
)

describe('reconciliation_exceptions schema (T-09.09.01)', () => {
  it('declares the domain columns expected by the service layer', () => {
    const columns = Object.keys(reconciliationExceptions)
    for (const column of [
      'exceptionType',
      'severity',
      'status',
      'description',
      'details',
      'assignedToId',
      'resolvedById',
      'resolutionNote',
      'resolvedAt',
    ]) {
      expect(columns).toContain(column)
    }
  })

  it('migration 0040 keeps the exception-type CHECK constraint', () => {
    expect(MIGRATION).toMatch(
      /chk_rex_type[\s\S]*CHECK \(exception_type IN \('wallet_mismatch', 'payment_mismatch'\)\)/,
    )
  })

  it('migration 0040 keeps the severity CHECK constraint', () => {
    expect(MIGRATION).toMatch(
      /chk_rex_severity[\s\S]*CHECK \(severity IN \('low', 'medium', 'high', 'critical'\)\)/,
    )
  })

  it('migration 0040 keeps the status CHECK constraint', () => {
    expect(MIGRATION).toMatch(
      /chk_rex_status[\s\S]*CHECK \(status IN \('open', 'investigating', 'resolved', 'closed'\)\)/,
    )
  })

  it('migration 0040 keeps the composite list index', () => {
    expect(MIGRATION).toMatch(
      /idx_reconciliation_exceptions_status_created_at[\s\S]*ON reconciliation_exceptions \(status, created_at DESC\)/,
    )
  })
})