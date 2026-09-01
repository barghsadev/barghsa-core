/**
 * Real-PostgreSQL integration tests for ManualInvoiceService
 * (T-04.1.02.02).
 *
 * Runs the actual service against a Testcontainers-managed PostgreSQL 17
 * instance (migrations 0052 → 0053 → 0054 → 0055 → 0057 → 0058 + audit_log) and proves:
 *
 *   1. Create + issue is ATOMIC: one BEGIN/COMMIT on a single connection.
 *   2. The invoice lands in `Unpaid` with issuedAt/payableFrom/dueAt set
 *      and the canonical `invoice.issue` audit entry written.
 *   3. Lines persist with computed lineTotal / vatAmount / position in
 *      staff entry order; a non-taxable line carries zero VAT.
 *   4. Half-up VAT rounding is applied at the line level.
 *   5. Idempotency: replay with the same key returns the same invoice.
 *   6. Errors roll back everything (no orphan Draft, no lines, no audit).
 *
 * Wiring: only `getDbPool()` is stubbed, handing the service the
 * schema-scoped pool of the isolated Testcontainers schema.
 */

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import { BadRequestException, NotFoundException } from '@nestjs/common'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { createIsolatedTestDb, dropTestSchema } from '@barghsa/db/test'
import type { IsolatedTestDb } from '@barghsa/db/test'
import { ManualInvoiceService } from './manual-invoice.service.js'
import { InvoiceStateMachineService } from './invoice-state-machine.service.js'
import { InvoiceAuditRepository } from './invoice-audit.repository.js'
import { DueAtCalculationRepository } from './due-at.repository.js'
import { DueAtCalculationService } from './due-at.service.js'

// ---- Real-DB wiring ------------------------------------------------------
const poolHolder = vi.hoisted(() => ({ pool: null as import('pg').Pool | null }))

vi.mock('@barghsa/db', () => ({
  getDbPool: () => {
    if (!poolHolder.pool) {
      throw new Error('test pool not initialized — beforeAll must run first')
    }
    return poolHolder.pool
  },
}))

// ---- Migrations / DDL -----------------------------------------------------
const UUIDV7_MIGRATION = resolve(
  __dirname,
  '../../../../packages/db/drizzle/0000_init_uuidv7_function.sql',
)
const INVOICES_MIGRATION = resolve(
  __dirname,
  '../../../../packages/db/drizzle/0052_add_invoice_amount_check_constraints.sql',
)
const PAID_OVERDUE_MIGRATION = resolve(
  __dirname,
  '../../../../packages/db/drizzle/0053_add_invoice_paid_overdue_timestamps.sql',
)
const LINES_ITEMS_MIGRATION = resolve(
  __dirname,
  '../../../../packages/db/drizzle/0054_create_invoice_lines_and_items.sql',
)
const POSITION_MIGRATION = resolve(
  __dirname,
  '../../../../packages/db/drizzle/0055_add_invoice_lines_position.sql',
)
const IDEMPOTENCY_MIGRATION = resolve(
  __dirname,
  '../../../../packages/db/drizzle/0057_add_invoice_type_idempotency.sql',
)
const CALCULATION_SNAPSHOT_MIGRATION = resolve(
  __dirname,
  '../../../../packages/db/drizzle/0058_add_invoice_calculation_snapshot.sql',
)
const DUE_PERIODS_MIGRATION = resolve(
  __dirname,
  '../../../../packages/db/drizzle/0059_create_service_due_periods.sql',
)
const AUDIT_LOG_MIGRATION = resolve(
  __dirname,
  '../../../../packages/db/drizzle/0005_create_audit_log.sql',
)
const ADJUSTMENT_KIND_MIGRATION = resolve(
  __dirname,
  '../../../../packages/db/drizzle/0067_invoice_adjustment_kind_accounting_amount.sql',
)

const PROFILE_ID = '22222222-2222-7222-8222-222222222222'
const ACTOR_USER_ID = 'staff-integration-manual'

describe('ManualInvoiceService — real PostgreSQL integration (T-04.1.02.02)', () => {
  let ctx: IsolatedTestDb
  let service: ManualInvoiceService

  beforeAll(async () => {
    ctx = await createIsolatedTestDb('test_', 2)
    poolHolder.pool = ctx.pool
    service = new ManualInvoiceService(
      new InvoiceStateMachineService(new InvoiceAuditRepository()),
      new DueAtCalculationService(new DueAtCalculationRepository()),
    )

    // --- DDL: uuid v7 fn, enum, minimal FK targets, then the invoice
    // migrations in production order (0052 → 0053 → 0054 → 0055) plus the
    // audit_log table. invoice_items references products, so a minimal
    // products table must exist before 0054.
    await ctx.pool.query(readFileSync(UUIDV7_MIGRATION, 'utf-8').trim())
    await ctx.db.execute(`CREATE TYPE invoice_state AS ENUM (
      'Draft', 'Unpaid', 'PaymentUnderReview', 'PartiallyFunded', 'Paid',
      'Overdue', 'Cancelled', 'PartiallyRefunded', 'Refunded'
    )`)
    await ctx.db.execute(`CREATE TABLE IF NOT EXISTS profiles (
      id UUID PRIMARY KEY DEFAULT uuid_generate_v7()
    )`)
    await ctx.db.execute(`CREATE TABLE IF NOT EXISTS orders (
      id UUID PRIMARY KEY DEFAULT uuid_generate_v7()
    )`)
    await ctx.db.execute(`CREATE TABLE IF NOT EXISTS products (
      id UUID PRIMARY KEY DEFAULT uuid_generate_v7()
    )`)
    await ctx.db.execute(`CREATE TABLE IF NOT EXISTS users (
      user_id TEXT PRIMARY KEY
    )`)

    await ctx.pool.query(readFileSync(INVOICES_MIGRATION, 'utf-8').trim())
    await ctx.pool.query(readFileSync(PAID_OVERDUE_MIGRATION, 'utf-8').trim())
    await ctx.pool.query(readFileSync(LINES_ITEMS_MIGRATION, 'utf-8').trim())
    await ctx.pool.query(readFileSync(POSITION_MIGRATION, 'utf-8').trim())
    await ctx.pool.query(readFileSync(IDEMPOTENCY_MIGRATION, 'utf-8').trim())
    await ctx.pool.query(readFileSync(CALCULATION_SNAPSHOT_MIGRATION, 'utf-8').trim())
    await ctx.pool.query(readFileSync(DUE_PERIODS_MIGRATION, 'utf-8').trim())
    await ctx.pool.query(readFileSync(AUDIT_LOG_MIGRATION, 'utf-8').trim())
    await ctx.pool.query(readFileSync(ADJUSTMENT_KIND_MIGRATION, 'utf-8').trim())

    // --- Seed data: one profile + one actor.
    await ctx.db.execute(
      `INSERT INTO profiles (id) VALUES ('${PROFILE_ID}')
       ON CONFLICT (id) DO NOTHING`,
    )
    await ctx.db.execute(
      `INSERT INTO users (user_id) VALUES ('${ACTOR_USER_ID}')
       ON CONFLICT (user_id) DO NOTHING`,
    )
  }, 60_000)

  afterAll(async () => {
    poolHolder.pool = null
    await ctx.pool.end()
    await dropTestSchema(ctx.schemaName)
  })

  // ---- Helpers ------------------------------------------------------------

  async function countAuditRows(invoiceId: string): Promise<number> {
    const result = await ctx.db.execute<{ n: number }>(
      `SELECT COUNT(*)::int AS n FROM audit_log
       WHERE event = 'invoice.issue'
         AND metadata::jsonb ->> 'invoiceId' = '${invoiceId}'`,
    )
    return result.rows[0]!.n
  }

  it('creates and issues a manual invoice atomically with correct totals', async () => {
    const result = await service.createManualInvoice({
      profileId: PROFILE_ID,
      actorUserId: ACTOR_USER_ID,
      lines: [
        { description: 'برق مصرفی — دوره اردیبهشت', quantity: 2, unitPrice: 500_000n, vatRate: 900 },
        { description: 'کارمزد اداری (بدون مالیات)', quantity: 1, unitPrice: 100_000n, vatRate: 0, isTaxable: false },
      ],
      correlationId: 'corr-manual-01',
      reason: 'Manual invoice for integration test',
      ip: '10.0.0.2',
    })

    // Line 1: 2 × 500,000 = 1,000,000 + VAT 90,000
    // Line 2: 1 × 100,000 = 100,000 + VAT 0 (non-taxable)
    expect(result.totalAmount).toBe(1_190_000n)
    expect(result.state).toBe('Unpaid')
    expect(result.contractId).toBeNull()
    expect(result.lines).toHaveLength(2)
    expect(result.lines[0]!.lineTotal).toBe(1_000_000n)
    expect(result.lines[0]!.vatAmount).toBe(90_000n)
    expect(result.lines[0]!.position).toBe(0)
    expect(result.lines[1]!.vatAmount).toBe(0n)
    expect(result.lines[1]!.position).toBe(1)
    expect(result.transition.transition).toBe('Issue')

    // --- Verify the stored invoice row
    const invoiceRow = await ctx.db.execute<{
      state: string
      total_amount: string
      issued_at: Date | null
      payable_from: Date | null
      due_at: Date | null
    }>(`SELECT state, total_amount, issued_at, payable_from, due_at
        FROM invoices WHERE id = '${result.invoiceId}'`)
    expect(invoiceRow.rows[0]!.state).toBe('Unpaid')
    expect(invoiceRow.rows[0]!.total_amount).toBe('1190000')
    expect(invoiceRow.rows[0]!.issued_at).not.toBeNull()
    expect(invoiceRow.rows[0]!.payable_from).not.toBeNull()
    expect(invoiceRow.rows[0]!.due_at).not.toBeNull()

    // --- Calculation snapshot: inputs, rounding steps, totals
    const snapRow = await ctx.db.execute<{
      invoice_calculation_snapshot: {
        version: number
        source: string
        inputs: { lines: Array<{ unitPrice: string; vatRate: number }> }
        steps: Array<{ vat: { result: string; numerator: string } }>
        totals: { totalAmount: string; totalVat: string; subtotal: string }
      } | null
    }>(`SELECT invoice_calculation_snapshot FROM invoices WHERE id = '${result.invoiceId}'`)
    const snap = snapRow.rows[0]!.invoice_calculation_snapshot
    expect(snap).not.toBeNull()
    expect(snap!.version).toBe(1)
    expect(snap!.source).toBe('manual')
    expect(snap!.inputs.lines).toHaveLength(2)
    expect(snap!.inputs.lines[0]!.unitPrice).toBe('500000')
    expect(snap!.inputs.lines[0]!.vatRate).toBe(900)
    expect(snap!.steps[0]!.vat.result).toBe('90000')
    expect(snap!.steps[0]!.vat.numerator).toBe('900000000')
    expect(snap!.totals.subtotal).toBe('1100000')
    expect(snap!.totals.totalVat).toBe('90000')
    expect(snap!.totals.totalAmount).toBe('1190000')

    // --- Exactly one canonical audit entry (invoice.issue)
    expect(await countAuditRows(result.invoiceId)).toBe(1)
  })

  it('applies half-up VAT rounding at the line level', async () => {
    const result = await service.createManualInvoice({
      profileId: PROFILE_ID,
      actorUserId: ACTOR_USER_ID,
      lines: [
        // 1 IRR at 50% → 0.5 → rounds up to 1
        { description: 'نیم تومان مالیات', quantity: 1, unitPrice: 1n, vatRate: 5000 },
      ],
    })

    expect(result.lines[0]!.vatAmount).toBe(1n)
    expect(result.totalAmount).toBe(2n)

    const stored = await ctx.db.execute<{ vat_amount: string; line_total: string }>(
      `SELECT vat_amount, line_total FROM invoice_lines WHERE invoice_id = '${result.invoiceId}'`,
    )
    expect(stored.rows[0]!.vat_amount).toBe('1')
  })

  it('defaults dueAt to issuedAt + 7 days (fallback) unless overridden', async () => {
    const withDefault = await service.createManualInvoice({
      profileId: PROFILE_ID,
      actorUserId: ACTOR_USER_ID,
      lines: [{ description: 'x', quantity: 1, unitPrice: 10_000n, vatRate: 0 }],
    })
    const defaultDue = new Date(withDefault.dueAt!).getTime()
    const defaultIssued = new Date(withDefault.issuedAt).getTime()
    expect(defaultDue - defaultIssued).toBe(7 * 24 * 60 * 60 * 1000)

    const explicit = new Date('2027-01-01T00:00:00.000Z')
    const withOverride = await service.createManualInvoice({
      profileId: PROFILE_ID,
      actorUserId: ACTOR_USER_ID,
      lines: [{ description: 'y', quantity: 1, unitPrice: 10_000n, vatRate: 0 }],
      dueAt: explicit,
    })
    expect(new Date(withOverride.dueAt!).getTime()).toBe(explicit.getTime())
  })

  it('computes dueAt as issuedAt + service_due_periods default_days', async () => {
    await ctx.db.execute(
      `INSERT INTO service_due_periods
         (service_type, default_days, effective_from, created_by)
       VALUES ('manual', 14, '2026-01-01T00:00:00.000Z', '${ACTOR_USER_ID}')`,
    )
    const issuedAt = new Date('2026-08-01T10:00:00.000Z')
    const result = await service.createManualInvoice({
      profileId: PROFILE_ID,
      actorUserId: ACTOR_USER_ID,
      now: issuedAt,
      lines: [{ description: 'config days', quantity: 1, unitPrice: 10_000n, vatRate: 0 }],
    })
    expect(new Date(result.dueAt!).getTime() - issuedAt.getTime()).toBe(
      14 * 24 * 60 * 60 * 1000,
    )
    await ctx.db.execute(`DELETE FROM service_due_periods WHERE service_type = 'manual'`)
  })

  it('replays the same invoice when the idempotency key is reused', async () => {
    const first = await service.createManualInvoice({
      profileId: PROFILE_ID,
      actorUserId: ACTOR_USER_ID,
      idempotencyKey: 'manual-idem-001',
      lines: [{ description: 'idem', quantity: 1, unitPrice: 200_000n, vatRate: 900 }],
    })

    const second = await service.createManualInvoice({
      profileId: PROFILE_ID,
      actorUserId: ACTOR_USER_ID,
      idempotencyKey: 'manual-idem-001',
      lines: [{ description: 'idem', quantity: 1, unitPrice: 200_000n, vatRate: 900 }],
    })

    expect(second.invoiceId).toBe(first.invoiceId)
    // No duplicate invoice, no duplicate audit row
    const result = await ctx.db.execute<{ n: number }>(
      `SELECT COUNT(*)::int AS n FROM invoices WHERE id = '${first.invoiceId}'`,
    )
    expect(result.rows[0]!.n).toBe(1)
    expect(await countAuditRows(first.invoiceId)).toBe(1)
    // The replay result still describes the same invoice
    expect(second.totalAmount).toBe(first.totalAmount)
  })

  it('throws BadRequestException for an invalid line list', async () => {
    await expect(
      service.createManualInvoice({
        profileId: PROFILE_ID,
        actorUserId: ACTOR_USER_ID,
        lines: [{ description: 'x', quantity: 0, unitPrice: 100n, vatRate: 0 }],
      }),
    ).rejects.toThrow(BadRequestException)
  })

  it('throws NotFoundException for a missing profile and leaves no rows', async () => {
    const missing = '99999999-9999-7999-8999-999999999999'
    await expect(
      service.createManualInvoice({
        profileId: missing,
        actorUserId: ACTOR_USER_ID,
        lines: [{ description: 'x', quantity: 1, unitPrice: 100n, vatRate: 0 }],
      }),
    ).rejects.toThrow(NotFoundException)

    const orphans = await ctx.db.execute<{ n: number }>(
      `SELECT COUNT(*)::int AS n FROM invoices WHERE profile_id = '${missing}'`,
    )
    expect(orphans.rows[0]!.n).toBe(0)
  })

  it('rolls back every row when the audit insert fails mid-transaction', async () => {
    // Break the audit_log FK by referencing a non-existent user for a
    // synthetic actor: the transition's audit insert then fails, which must
    // roll back the invoice AND its lines AND the audit row (no orphan
    // Draft, no orphan lines, no partial audit trail).
    const before = {
      invoices: (await ctx.db.execute<{ n: number }>(`SELECT COUNT(*)::int AS n FROM invoices`)).rows[0]!.n,
      lines: (await ctx.db.execute<{ n: number }>(`SELECT COUNT(*)::int AS n FROM invoice_lines`)).rows[0]!.n,
      audit: (await ctx.db.execute<{ n: number }>(`SELECT COUNT(*)::int AS n FROM audit_log`)).rows[0]!.n,
    }

    await expect(
      service.createManualInvoice({
        profileId: PROFILE_ID,
        actorUserId: 'ghost-staff-no-user-row',
        lines: [{ description: 'x', quantity: 1, unitPrice: 100n, vatRate: 0 }],
      }),
    ).rejects.toThrow()

    const after = {
      invoices: (await ctx.db.execute<{ n: number }>(`SELECT COUNT(*)::int AS n FROM invoices`)).rows[0]!.n,
      lines: (await ctx.db.execute<{ n: number }>(`SELECT COUNT(*)::int AS n FROM invoice_lines`)).rows[0]!.n,
      audit: (await ctx.db.execute<{ n: number }>(`SELECT COUNT(*)::int AS n FROM audit_log`)).rows[0]!.n,
    }
    expect(after.invoices).toBe(before.invoices)
    expect(after.lines).toBe(before.lines)
    expect(after.audit).toBe(before.audit)

    // No Draft invoice may linger for the profile after the failed create
    const drafts = await ctx.db.execute<{ n: number }>(
      `SELECT COUNT(*)::int AS n FROM invoices
       WHERE profile_id = '${PROFILE_ID}' AND state = 'Draft'`,
    )
    expect(drafts.rows[0]!.n).toBe(0)
  })

  it('rejects an idempotency key reused with a different payload', async () => {
    await service.createManualInvoice({
      profileId: PROFILE_ID,
      actorUserId: ACTOR_USER_ID,
      idempotencyKey: 'manual-idem-conflict',
      lines: [{ description: 'first', quantity: 1, unitPrice: 100_000n, vatRate: 0 }],
    })

    await expect(
      service.createManualInvoice({
        profileId: PROFILE_ID,
        actorUserId: ACTOR_USER_ID,
        idempotencyKey: 'manual-idem-conflict',
        lines: [{ description: 'DIFFERENT', quantity: 2, unitPrice: 200_000n, vatRate: 900 }],
      }),
    ).rejects.toThrow()

    // Still exactly one invoice with the key
    const result = await ctx.db.execute<{ n: number }>(
      `SELECT COUNT(*)::int AS n FROM invoices
       WHERE metadata->>'idempotencyKey' = 'manual-idem-conflict'`,
    )
    expect(result.rows[0]!.n).toBe(1)
  })

  it('never returns another profile invoice on an idempotency key collision', async () => {
    // Second profile exists so a cross-profile key collision is possible
    const otherProfile = '33333333-3333-7333-8333-333333333333'
    await ctx.db.execute(
      `INSERT INTO profiles (id) VALUES ('${otherProfile}') ON CONFLICT (id) DO NOTHING`,
    )

    const first = await service.createManualInvoice({
      profileId: PROFILE_ID,
      actorUserId: ACTOR_USER_ID,
      idempotencyKey: 'shared-key-001',
      lines: [{ description: 'for profile A', quantity: 1, unitPrice: 50_000n, vatRate: 0 }],
    })

    // Same key on a different profile must create a NEW invoice, not
    // replay profile A's invoice.
    const second = await service.createManualInvoice({
      profileId: otherProfile,
      actorUserId: ACTOR_USER_ID,
      idempotencyKey: 'shared-key-001',
      lines: [{ description: 'for profile B', quantity: 1, unitPrice: 60_000n, vatRate: 0 }],
    })

    expect(second.invoiceId).not.toBe(first.invoiceId)
    expect(second.profileId).toBe(otherProfile)
  })
})