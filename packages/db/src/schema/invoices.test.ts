import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
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
  resolve(__dirname, '../../drizzle/0052_add_invoice_amount_check_constraints.sql'),
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
      'consultationId',
      'state',
      'totalAmount',
      'paidAmount',
      'refundedAmount',
      'issuedAt',
      'payableFrom',
      'dueAt',
      'cancelledAt',
      'metadata',
      'invoiceCalculationSnapshot',
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

  it('migration 0052 backfills the non-negative column CHECKs for legacy tables', () => {
    expect(MIGRATION).toMatch(/ADD CONSTRAINT ck_invoices_total_amount_nonneg[\s\S]*CHECK \(total_amount >= 0\)/)
    expect(MIGRATION).toMatch(/ADD CONSTRAINT ck_invoices_paid_amount_nonneg[\s\S]*CHECK \(paid_amount >= 0\)/)
    expect(MIGRATION).toMatch(/ADD CONSTRAINT ck_invoices_refunded_amount_nonneg[\s\S]*CHECK \(refunded_amount >= 0\)/)
  })

  it('migration 0052 is idempotent (matching sibling migrations)', () => {
    expect(MIGRATION).toContain('CREATE TABLE IF NOT EXISTS invoices')
    expect(MIGRATION).toMatch(/IF to_regclass\('invoices'\) IS NOT NULL/)
    expect(MIGRATION).toContain('CREATE INDEX IF NOT EXISTS idx_invoices_profile_id')
    expect(MIGRATION).toContain('CREATE INDEX IF NOT EXISTS idx_invoices_state')
    expect(MIGRATION).toContain('CREATE INDEX IF NOT EXISTS idx_invoices_due_at')
    expect(MIGRATION).toContain('CREATE INDEX IF NOT EXISTS idx_invoices_order_id')
  })
})

/**
 * Drift guard for the invoice origin-link migration (T-04.1.02.05).
 *
 * Migration 0056 adds the nullable `consultation_id` origin column and the
 * contract/consultation lookup indexes. `order_id` already exists as a
 * nullable FK. `contract_id` / `consultation_id` are deferred FKs (target
 * tables TBD) — the columns carry the origin reference from day one. If a
 * future `drizzle-kit generate` rewrite or manual edit drops the column or
 * an index, this test fails instead of silently unlinking invoices from
 * their origin.
 */
const ORIGIN_MIGRATION = readFileSync(
  resolve(__dirname, '../../drizzle/0056_add_invoice_origin_links.sql'),
  'utf8',
)

describe('Invoice origin links schema (T-04.1.02.05)', () => {
  it('invoices table declares all three origin columns', () => {
    const columns = Object.keys(invoices)
    expect(columns).toContain('orderId')
    expect(columns).toContain('contractId')
    expect(columns).toContain('consultationId')
  })

  it('orderId, contractId, consultationId are all nullable origin columns', () => {
    // orderId is a real nullable FK to orders (verified against the DB in
    // invoices-origin.test.ts via pg_constraint).
    expect(invoices.orderId.notNull).toBe(false)

    // contractId / consultationId — nullable deferred FK columns (target
    // tables TBD).
    expect(invoices.contractId.notNull).toBe(false)
    expect(invoices.consultationId.notNull).toBe(false)
  })

  it('migration 0056 adds consultation_id and the contract/consultation indexes', () => {
    expect(ORIGIN_MIGRATION).toContain(
      'ALTER TABLE invoices\n  ADD COLUMN IF NOT EXISTS consultation_id TEXT;',
    )
    expect(ORIGIN_MIGRATION).toContain(
      'CREATE INDEX IF NOT EXISTS idx_invoices_contract_id ON invoices (contract_id)',
    )
    expect(ORIGIN_MIGRATION).toContain(
      'CREATE INDEX IF NOT EXISTS idx_invoices_consultation_id ON invoices (consultation_id)',
    )
  })
})

/**
 * Drift guard for the invoice calculation snapshot column (T-04.1.02.08).
 *
 * Migration 0058 adds nullable `invoice_calculation_snapshot` JSONB so
 * issued invoices keep every calculation input, VAT half-up rounding
 * step, and final total. If a future rewrite drops the column, this
 * test fails instead of silently losing reproducibility.
 */
const CALCULATION_SNAPSHOT_MIGRATION = readFileSync(
  resolve(__dirname, '../../drizzle/0058_add_invoice_calculation_snapshot.sql'),
  'utf8',
)

describe('Invoice calculation snapshot schema (T-04.1.02.08)', () => {
  it('invoices table declares invoiceCalculationSnapshot', () => {
    const columns = Object.keys(invoices)
    expect(columns).toContain('invoiceCalculationSnapshot')
  })

  it('invoiceCalculationSnapshot is nullable JSONB (legacy rows stay valid)', () => {
    expect(invoices.invoiceCalculationSnapshot.notNull).toBe(false)
  })

  it('migration 0058 adds the column idempotently', () => {
    expect(CALCULATION_SNAPSHOT_MIGRATION).toContain(
      'ALTER TABLE invoices\n  ADD COLUMN IF NOT EXISTS invoice_calculation_snapshot JSONB;',
    )
  })

  it('migration 0058 is registered in the Drizzle journal so migrate() applies it', () => {
    const journal = JSON.parse(
      readFileSync(resolve(__dirname, '../../drizzle/meta/_journal.json'), 'utf8'),
    ) as { entries: Array<{ tag: string }> }
    expect(journal.entries.map((entry) => entry.tag)).toContain(
      '0058_add_invoice_calculation_snapshot',
    )
  })
})
