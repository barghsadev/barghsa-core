import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { getTableConfig } from 'drizzle-orm/pg-core'
import { invoices } from './invoices.js'

/**
 * Drift guard for the invoices table constraints (T-04.1.01.04).
 *
 * The two amount invariants — paid_amount <= total_amount and
 * refunded_amount <= paid_amount — are enforced at the database level by
 * migration 0052. Drizzle v0.40's pg-core does expose `.check()` on the
 * table, and the schema declares them, but hand-written SQL migrations are
 * the durable enforcement path (and the other E-04 related tables follow
 * the same pattern as migrations 0041/0048/0050). This test asserts:
 *
 *   1. the Drizzle schema still declares the checks AND the columns the
 *      service layer relies on,
 *   2. migration 0052 still declares both named CHECK constraints,
 *   3. migration 0052 remains idempotent (CREATE TABLE IF NOT EXISTS +
 *      guarded backfill) so production re-runs never fail.
 *
 * If a future `drizzle-kit generate` rewrite or manual edit drops a
 * constraint, this test fails instead of silently loosening the invoice
 * money-safety posture.
 */
const MIGRATION = readFileSync(
  join(process.cwd(), 'drizzle', '0052_add_invoice_amount_check_constraints.sql'),
  'utf8',
)

describe('Invoice amount constraints schema (T-04.1.01.04)', () => {
  it('invoices table declares the domain columns expected by the service layer', () => {
    const columns = Object.keys(invoices)
    for (const column of [
      'id',
      'profileId',
      'orderId',
      'contractId',
      'state',
      'totalAmount',
      'paidAmount',
      'refundedAmount',
      'issuedAt',
      'payableFrom',
      'dueAt',
      'cancelledAt',
      'metadata',
    ]) {
      expect(columns).toContain(column)
    }
  })

  it('Drizzle schema declares table-level CHECK constraints for both invariants', () => {
    const { checks } = getTableConfig(invoices)
    const names = checks.map((c) => String(c.name))
    expect(names).toContain('ck_paid_not_exceeds_total')
    expect(names).toContain('ck_refund_not_exceeds_paid')
  })

  it('migration 0052 still declares both named CHECK constraints', () => {
    expect(MIGRATION).toContain(
      'CONSTRAINT ck_paid_not_exceeds_total CHECK (paid_amount <= total_amount)',
    )
    expect(MIGRATION).toContain(
      'CONSTRAINT ck_refund_not_exceeds_paid CHECK (refunded_amount <= paid_amount)',
    )
    // Backfill path re-declares the same constraints.
    expect(MIGRATION).toMatch(/ADD CONSTRAINT ck_paid_not_exceeds_total[\s\S]*CHECK \(paid_amount <= total_amount\)/)
    expect(MIGRATION).toMatch(/ADD CONSTRAINT ck_refund_not_exceeds_paid[\s\S]*CHECK \(refunded_amount <= paid_amount\)/)
  })

  it('migration 0052 is idempotent (matching sibling migrations)', () => {
    expect(MIGRATION).toContain('CREATE TABLE IF NOT EXISTS invoices')
    expect(MIGRATION).toMatch(/IF NOT EXISTS \(\s*SELECT 1 FROM pg_constraint/)
    expect(MIGRATION).toContain('CREATE INDEX IF NOT EXISTS idx_invoices_profile_id')
    expect(MIGRATION).toContain('CREATE INDEX IF NOT EXISTS idx_invoices_state')
    expect(MIGRATION).toContain('CREATE INDEX IF NOT EXISTS idx_invoices_due_at')
    expect(MIGRATION).toContain('CREATE INDEX IF NOT EXISTS idx_invoices_order_id')
  })
})