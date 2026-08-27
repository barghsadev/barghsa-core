import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { approvalRequests } from './approval-requests.js'

/**
 * Drift guard for the approval_requests table (T-09.07.02).
 *
 * The CHECK constraints for this table live in migration 0036 (Drizzle
 * v0.40's column builder has no `.check()`), so this test asserts the
 * migration still declares them and the composite queue index. If a future
 * `drizzle-kit generate` ever rewrites the migration and drops a
 * constraint, this test fails instead of silently loosening the financial
 * control.
 */
const MIGRATION = readFileSync(
  join(process.cwd(), 'drizzle', '0036_create_approval_requests.sql'),
  'utf8',
)

describe('approval_requests schema (T-09.07.02)', () => {
  it('declares the domain columns expected by the service layer', () => {
    const columns = Object.keys(approvalRequests)
    for (const column of [
      'actionType',
      'amountIrR',
      'initiatorId',
      'reason',
      'details',
      'status',
      'reviewerId',
      'reviewReason',
      'reviewedAt',
    ]) {
      expect(columns).toContain(column)
    }
  })

  it('migration 0036 keeps the action-type CHECK constraint', () => {
    expect(MIGRATION).toMatch(
      /chk_ar_action_type[\s\S]*CHECK \(action_type IN \('refund', 'manual_adjustment', 'bank_payment_confirmation'\)\)/,
    )
  })

  it('migration 0036 keeps the positive-amount CHECK constraint', () => {
    expect(MIGRATION).toMatch(/chk_ar_amount_positive[\s\S]*CHECK \(amount_irr > 0\)/)
  })

  it('migration 0036 keeps the status CHECK constraint', () => {
    expect(MIGRATION).toMatch(/chk_ar_status[\s\S]*CHECK \(status IN \('pending', 'approved', 'rejected'\)\)/)
  })

  it('migration 0036 keeps the composite queue index', () => {
    expect(MIGRATION).toMatch(
      /idx_approval_requests_status_created_at[\s\S]*ON approval_requests \(status, created_at DESC\)/,
    )
  })
})