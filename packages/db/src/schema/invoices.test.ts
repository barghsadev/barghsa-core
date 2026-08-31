import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { getTableConfig } from 'drizzle-orm/pg-core'
import { createInvoicesTable, invoices } from './invoices.js'

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
      'replacesInvoiceId',
      'adjustmentForInvoiceId',
      'adjustmentKind',
      'accountingAmount',
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

/**
 * Drift guard for invoice correction self-references (T-04.1.05.01).
 *
 * Migration 0064 adds nullable `replaces_invoice_id` and
 * `adjustment_for_invoice_id` UUID self-FKs so cancel+replace and
 * adjustment invoices can point at the original they correct. If a
 * future rewrite drops a column, FK, or lookup index, this test fails
 * instead of silently unlinking the correction chain.
 */
const CORRECTION_MIGRATION = readFileSync(
  resolve(__dirname, '../../drizzle/0064_add_invoice_correction_self_references.sql'),
  'utf8',
)

describe('Invoice correction self-references schema (T-04.1.05.01)', () => {
  it('invoices table declares replacesInvoiceId and adjustmentForInvoiceId', () => {
    const columns = Object.keys(invoices)
    expect(columns).toContain('replacesInvoiceId')
    expect(columns).toContain('adjustmentForInvoiceId')
  })

  it('both correction links are nullable UUID columns (legacy rows stay valid)', () => {
    expect(invoices.replacesInvoiceId.notNull).toBe(false)
    expect(invoices.adjustmentForInvoiceId.notNull).toBe(false)
  })

  it('Drizzle schema declares RESTRICT self-FKs and lookup indexes', () => {
    const { foreignKeys, indexes } = getTableConfig(invoices)
    const selfFks = foreignKeys.filter((fk) => fk.reference().foreignTable === invoices)
    const localColumns = selfFks.flatMap((fk) => fk.reference().columns.map((col) => col.name))
    expect(localColumns).toEqual(
      expect.arrayContaining(['replaces_invoice_id', 'adjustment_for_invoice_id']),
    )
    expect(selfFks.length).toBeGreaterThanOrEqual(2)
    for (const fk of selfFks) {
      expect(fk.onDelete).toBe('restrict')
    }

    const indexNames = indexes.map((idx) => idx.config.name)
    expect(indexNames).toEqual(
      expect.arrayContaining([
        'idx_invoices_replaces_invoice_id',
        'idx_invoices_adjustment_for_invoice_id',
      ]),
    )
  })

  it('migration 0064 adds both columns as nullable UUID self-FKs', () => {
    expect(CORRECTION_MIGRATION).toContain(
      'ADD COLUMN IF NOT EXISTS replaces_invoice_id UUID',
    )
    expect(CORRECTION_MIGRATION).toContain(
      'ADD COLUMN IF NOT EXISTS adjustment_for_invoice_id UUID',
    )
    expect(CORRECTION_MIGRATION).toMatch(
      /replaces_invoice_id UUID\s+REFERENCES invoices\(id\) ON DELETE RESTRICT/,
    )
    expect(CORRECTION_MIGRATION).toMatch(
      /adjustment_for_invoice_id UUID\s+REFERENCES invoices\(id\) ON DELETE RESTRICT/,
    )
  })

  it('migration 0064 creates lookup indexes idempotently', () => {
    expect(CORRECTION_MIGRATION).toContain(
      'CREATE INDEX IF NOT EXISTS idx_invoices_replaces_invoice_id',
    )
    expect(CORRECTION_MIGRATION).toContain(
      'CREATE INDEX IF NOT EXISTS idx_invoices_adjustment_for_invoice_id',
    )
  })

  it('migration 0064 is registered in the Drizzle journal so migrate() applies it', () => {
    const journal = JSON.parse(
      readFileSync(resolve(__dirname, '../../drizzle/meta/_journal.json'), 'utf8'),
    ) as { entries: Array<{ tag: string; when: number }> }
    const tags = journal.entries.map((entry) => entry.tag)
    expect(tags).toContain('0064_add_invoice_correction_self_references')
    const correction = journal.entries.find(
      (entry) => entry.tag === '0064_add_invoice_correction_self_references',
    )
    const prior = journal.entries.find(
      (entry) => entry.tag === '0063_cancel_reminders_on_invoice_stop_state',
    )
    expect(correction).toBeDefined()
    expect(prior).toBeDefined()
    expect(correction!.when).toBeGreaterThan(prior!.when)
  })
})

/**
 * Drift guard for the correction-safe (order_id, type) unique index
 * (T-04.1.05.02).
 *
 * Migration 0065 rewrites `uq_invoices_order_id_type` as a partial unique
 * index over ordinary invoices (`replaces_invoice_id IS NULL`) so a
 * cancel+replace successor can copy `order_id` without colliding with the
 * cancelled original or a sibling manual invoice, while ordinary
 * auto/manual idempotency is unchanged.
 */
const ORDER_TYPE_REPLACEMENT_MIGRATION = readFileSync(
  resolve(
    __dirname,
    '../../drizzle/0065_invoice_order_type_unique_exclude_replacements.sql',
  ),
  'utf8',
)

describe('Invoice order-type unique index excludes replacements (T-04.1.05.02)', () => {
  it('Drizzle unique index is partial on replaces_invoice_id IS NULL', () => {
    const { indexes } = getTableConfig(invoices)
    const orderType = indexes.find((idx) => idx.config.name === 'uq_invoices_order_id_type')
    expect(orderType).toBeDefined()
    expect(orderType!.config.unique).toBe(true)
    expect(orderType!.config.where).toBeDefined()
    const chunks = (
      orderType!.config.where as { queryChunks?: unknown[] } | undefined
    )?.queryChunks
    const rendered = (chunks ?? [])
      .map((chunk) => {
        if (typeof chunk === 'string') return chunk
        if (chunk && typeof chunk === 'object' && 'name' in chunk) {
          return String((chunk as { name: unknown }).name)
        }
        return ''
      })
      .join('')
    expect(rendered).toContain('replaces_invoice_id')
    expect(rendered).toContain('adjustment_for_invoice_id')
  })

  it('createInvoicesTable SQL declares the partial unique index', () => {
    const schemaSql = readFileSync(resolve(__dirname, './invoices.ts'), 'utf8')
    expect(schemaSql).toMatch(
      /uq_invoices_order_id_type[\s\S]*WHERE replaces_invoice_id IS NULL AND adjustment_for_invoice_id IS NULL/,
    )
    expect(createInvoicesTable).toBeDefined()
  })

  it('migration 0065 rewrites the unique index as partial and is idempotent', () => {
    expect(ORDER_TYPE_REPLACEMENT_MIGRATION).toContain(
      'DROP INDEX IF EXISTS uq_invoices_order_id_type',
    )
    expect(ORDER_TYPE_REPLACEMENT_MIGRATION).toMatch(
      /CREATE UNIQUE INDEX IF NOT EXISTS uq_invoices_order_id_type[\s\S]*WHERE replaces_invoice_id IS NULL/,
    )
  })

  it('migration 0065 is registered in the Drizzle journal so migrate() applies it', () => {
    const journal = JSON.parse(
      readFileSync(resolve(__dirname, '../../drizzle/meta/_journal.json'), 'utf8'),
    ) as { entries: Array<{ tag: string; when: number }> }
    const tags = journal.entries.map((entry) => entry.tag)
    expect(tags).toContain('0065_invoice_order_type_unique_exclude_replacements')
    const rewrite = journal.entries.find(
      (entry) => entry.tag === '0065_invoice_order_type_unique_exclude_replacements',
    )
    const prior = journal.entries.find(
      (entry) => entry.tag === '0064_add_invoice_correction_self_references',
    )
    expect(rewrite).toBeDefined()
    expect(prior).toBeDefined()
    expect(rewrite!.when).toBeGreaterThan(prior!.when)
  })
})

/**
 * Drift guard for the adjustment-safe (order_id, type) unique index
 * (T-04.1.05.03).
 *
 * Migration 0066 extends `uq_invoices_order_id_type` so adjustment
 * invoices (`adjustment_for_invoice_id IS NOT NULL`) are excluded the
 * same way replacements are. Ordinary auto/manual idempotency is
 * unchanged.
 */
const ORDER_TYPE_ADJUSTMENT_MIGRATION = readFileSync(
  resolve(
    __dirname,
    '../../drizzle/0066_invoice_order_type_unique_exclude_adjustments.sql',
  ),
  'utf8',
)

describe('Invoice order-type unique index excludes adjustments (T-04.1.05.03)', () => {
  it('migration 0066 rewrites the unique index to exclude both correction FKs', () => {
    expect(ORDER_TYPE_ADJUSTMENT_MIGRATION).toContain(
      'DROP INDEX IF EXISTS uq_invoices_order_id_type',
    )
    expect(ORDER_TYPE_ADJUSTMENT_MIGRATION).toMatch(
      /CREATE UNIQUE INDEX IF NOT EXISTS uq_invoices_order_id_type[\s\S]*WHERE replaces_invoice_id IS NULL AND adjustment_for_invoice_id IS NULL/,
    )
  })

  it('migration 0066 is registered in the Drizzle journal so migrate() applies it', () => {
    const journal = JSON.parse(
      readFileSync(resolve(__dirname, '../../drizzle/meta/_journal.json'), 'utf8'),
    ) as { entries: Array<{ tag: string; when: number }> }
    const tags = journal.entries.map((entry) => entry.tag)
    expect(tags).toContain('0066_invoice_order_type_unique_exclude_adjustments')
    const rewrite = journal.entries.find(
      (entry) => entry.tag === '0066_invoice_order_type_unique_exclude_adjustments',
    )
    const prior = journal.entries.find(
      (entry) => entry.tag === '0065_invoice_order_type_unique_exclude_replacements',
    )
    expect(rewrite).toBeDefined()
    expect(prior).toBeDefined()
    expect(rewrite!.when).toBeGreaterThan(prior!.when)
  })
})

/**
 * Drift guard for first-class adjustment kind + signed accounting amount
 * (T-04.1.05.03).
 *
 * Migration 0067 adds nullable `adjustment_kind` and generated
 * `accounting_amount`, backfills existing linked rows, and adds the
 * kind/link CHECK as NOT VALID (VALIDATE is a later contract phase).
 */
const ADJUSTMENT_KIND_MIGRATION = readFileSync(
  resolve(
    __dirname,
    '../../drizzle/0067_invoice_adjustment_kind_accounting_amount.sql',
  ),
  'utf8',
)

describe('Invoice adjustment kind and accounting amount (T-04.1.05.03)', () => {
  it('Drizzle schema declares adjustmentKind and accountingAmount', () => {
    const columns = Object.keys(invoices)
    expect(columns).toContain('adjustmentKind')
    expect(columns).toContain('accountingAmount')
  })

  it('Drizzle schema declares the kind/link CHECK', () => {
    const { checks } = getTableConfig(invoices)
    const names = checks.map((c) => String(c.name))
    expect(names).toContain('ck_invoices_adjustment_kind_matches_link')
  })

  it('migration 0067 adds generated accounting_amount and kind CHECK', () => {
    expect(ADJUSTMENT_KIND_MIGRATION).toContain('ADD COLUMN adjustment_kind TEXT')
    expect(ADJUSTMENT_KIND_MIGRATION).toContain('GENERATED ALWAYS AS')
    expect(ADJUSTMENT_KIND_MIGRATION).toContain(
      "WHEN adjustment_kind = 'credit' THEN -total_amount",
    )
    expect(ADJUSTMENT_KIND_MIGRATION).toContain(
      'ck_invoices_adjustment_kind_matches_link',
    )
    expect(ADJUSTMENT_KIND_MIGRATION).toContain('NOT VALID')
    expect(ADJUSTMENT_KIND_MIGRATION).toContain(
      'WHERE adjustment_for_invoice_id IS NOT NULL',
    )
    expect(ADJUSTMENT_KIND_MIGRATION).toContain(
      "WHEN metadata->>'kind' IN ('charge', 'credit')",
    )
  })

  it('migration 0067 is registered in the Drizzle journal so migrate() applies it', () => {
    const journal = JSON.parse(
      readFileSync(resolve(__dirname, '../../drizzle/meta/_journal.json'), 'utf8'),
    ) as { entries: Array<{ tag: string; when: number }> }
    const tags = journal.entries.map((entry) => entry.tag)
    expect(tags).toContain('0067_invoice_adjustment_kind_accounting_amount')
    const next = journal.entries.find(
      (entry) => entry.tag === '0067_invoice_adjustment_kind_accounting_amount',
    )
    const prior = journal.entries.find(
      (entry) => entry.tag === '0066_invoice_order_type_unique_exclude_adjustments',
    )
    expect(next).toBeDefined()
    expect(prior).toBeDefined()
    expect(next!.when).toBeGreaterThan(prior!.when)
  })
})
