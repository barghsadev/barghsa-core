/**
 * Real-PostgreSQL integration tests for CreateAdjustmentInvoiceService
 * (T-04.1.05.03).
 *
 * Proves against actual PostgreSQL:
 *   1. Paid invoice receives a linked additional-charge invoice with
 *      `adjustment_for_invoice_id` set; original state/lines/amounts
 *      are unchanged.
 *   2. Negative amount stores a non-negative credit total and null due_at.
 *   3. Unpaid originals are rejected and left untouched.
 *   4. Multiple adjustments on the same order-linked original do not
 *      collide with `uq_invoices_order_id_type`.
 */

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import { ConflictException, NotFoundException } from '@nestjs/common'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { v7 as uuidv7 } from 'uuid'
import { createIsolatedTestDb, dropTestSchema } from '@barghsa/db/test'
import type { IsolatedTestDb } from '@barghsa/db/test'
import { CreateAdjustmentInvoiceService } from './create-adjustment-invoice.service.js'
import { InvoiceStateMachineService } from './invoice-state-machine.service.js'
import { InvoiceAuditRepository } from './invoice-audit.repository.js'
import { DueAtCalculationRepository } from './due-at.repository.js'
import { DueAtCalculationService } from './due-at.service.js'

const poolHolder = vi.hoisted(() => ({ pool: null as import('pg').Pool | null }))

vi.mock('@barghsa/db', () => ({
  getDbPool: () => {
    if (!poolHolder.pool) {
      throw new Error('test pool not initialized — beforeAll must run first')
    }
    return poolHolder.pool
  },
}))

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
const ORIGIN_MIGRATION = resolve(
  __dirname,
  '../../../../packages/db/drizzle/0056_add_invoice_origin_links.sql',
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
const CORRECTION_MIGRATION = resolve(
  __dirname,
  '../../../../packages/db/drizzle/0064_add_invoice_correction_self_references.sql',
)
const REPLACEMENT_INDEX_MIGRATION = resolve(
  __dirname,
  '../../../../packages/db/drizzle/0065_invoice_order_type_unique_exclude_replacements.sql',
)
const ADJUSTMENT_INDEX_MIGRATION = resolve(
  __dirname,
  '../../../../packages/db/drizzle/0066_invoice_order_type_unique_exclude_adjustments.sql',
)

const PROFILE_ID = '33333333-3333-7333-8333-333333333333'
const ACTOR_USER_ID = 'staff-create-adjustment'
const ISSUED = new Date('2026-08-01T10:00:00.000Z')
const DUE = new Date('2026-08-08T10:00:00.000Z')
const NOW = new Date('2026-08-15T12:00:00.000Z')
const ORIGINAL_TOTAL = 1_090_000n

describe('CreateAdjustmentInvoiceService — real PostgreSQL (T-04.1.05.03)', () => {
  let ctx: IsolatedTestDb
  let service: CreateAdjustmentInvoiceService

  beforeAll(async () => {
    ctx = await createIsolatedTestDb('test_', 2)
    poolHolder.pool = ctx.pool
    service = new CreateAdjustmentInvoiceService(
      new InvoiceStateMachineService(new InvoiceAuditRepository()),
      new DueAtCalculationService(new DueAtCalculationRepository()),
    )

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
    await ctx.pool.query(readFileSync(ORIGIN_MIGRATION, 'utf-8').trim())
    await ctx.pool.query(readFileSync(IDEMPOTENCY_MIGRATION, 'utf-8').trim())
    await ctx.pool.query(readFileSync(CALCULATION_SNAPSHOT_MIGRATION, 'utf-8').trim())
    await ctx.pool.query(readFileSync(DUE_PERIODS_MIGRATION, 'utf-8').trim())
    await ctx.pool.query(readFileSync(AUDIT_LOG_MIGRATION, 'utf-8').trim())
    await ctx.pool.query(readFileSync(CORRECTION_MIGRATION, 'utf-8').trim())
    await ctx.pool.query(readFileSync(REPLACEMENT_INDEX_MIGRATION, 'utf-8').trim())
    await ctx.pool.query(readFileSync(ADJUSTMENT_INDEX_MIGRATION, 'utf-8').trim())

    await ctx.db.execute(
      `INSERT INTO profiles (id) VALUES ('${PROFILE_ID}') ON CONFLICT (id) DO NOTHING`,
    )
    await ctx.db.execute(
      `INSERT INTO users (user_id) VALUES ('${ACTOR_USER_ID}') ON CONFLICT (user_id) DO NOTHING`,
    )
  }, 60_000)

  afterAll(async () => {
    poolHolder.pool = null
    await ctx.pool.end()
    await dropTestSchema(ctx.schemaName)
  })

  async function insertInvoice(opts: {
    state: string
    paidAmount?: bigint
    type?: string
    orderId?: string | null
  }): Promise<string> {
    const id = uuidv7()
    let orderId: string | null
    if (opts.orderId === undefined) {
      orderId = uuidv7()
      await ctx.pool.query(`INSERT INTO orders (id) VALUES ($1)`, [orderId])
    } else {
      orderId = opts.orderId
    }
    const paidAmount = opts.paidAmount ?? (opts.state === 'Paid' ? ORIGINAL_TOTAL : 0n)
    await ctx.pool.query(
      `INSERT INTO invoices
         (id, profile_id, order_id, type, state, total_amount, paid_amount,
          issued_at, payable_from, due_at, metadata)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $8, $9, $10::jsonb)`,
      [
        id,
        PROFILE_ID,
        orderId,
        opts.type ?? 'auto',
        opts.state,
        ORIGINAL_TOTAL,
        paidAmount,
        ISSUED,
        DUE,
        JSON.stringify({ source: opts.type ?? 'auto' }),
      ],
    )
    await ctx.pool.query(
      `INSERT INTO invoice_lines
         (id, invoice_id, description, quantity, unit_price, line_total,
          vat_rate, vat_amount, is_taxable, position)
       VALUES ($1, $2, $3, 1, $4, $4, 0, 0, false, 0)`,
      [uuidv7(), id, 'Original billed usage', ORIGINAL_TOTAL],
    )
    return id
  }

  async function originalSnapshot(invoiceId: string) {
    const invoice = await ctx.pool.query<{
      state: string
      total_amount: string
      paid_amount: string
      metadata: Record<string, unknown>
    }>(
      `SELECT state, total_amount, paid_amount, metadata FROM invoices WHERE id = $1`,
      [invoiceId],
    )
    const lines = await ctx.pool.query<{
      description: string
      line_total: string
    }>(
      `SELECT description, line_total::text AS line_total
         FROM invoice_lines WHERE invoice_id = $1 ORDER BY position`,
      [invoiceId],
    )
    return { invoice: invoice.rows[0]!, lines: lines.rows }
  }

  it('creates a linked additional-charge invoice without editing the original', async () => {
    const originalId = await insertInvoice({ state: 'Paid' })
    const before = await originalSnapshot(originalId)

    const result = await service.createAdjustmentInvoice({
      originalInvoiceId: originalId,
      amount: 250_000n,
      reason: 'Post-payment quantity increase',
      actorUserId: ACTOR_USER_ID,
      correlationId: 'corr-adj-charge-01',
      ip: '10.0.0.4',
      now: NOW,
    })

    expect(result.kind).toBe('charge')
    expect(result.amount).toBe(250_000n)
    expect(result.totalAmount).toBe(250_000n)
    expect(result.originalInvoiceId).toBe(originalId)
    expect(result.originalState).toBe('Paid')
    expect(result.adjustmentForInvoiceId).toBe(originalId)
    expect(result.adjustmentState).toBe('Unpaid')
    expect(result.dueAt).not.toBeNull()
    expect(result.issuedAt.toISOString()).toBe(NOW.toISOString())
    expect(result.lines).toHaveLength(1)
    expect(result.lines[0]!.lineTotal).toBe(250_000n)
    expect(result.lines[0]!.vatAmount).toBe(0n)
    expect(result.lines[0]!.isTaxable).toBe(false)

    const after = await originalSnapshot(originalId)
    expect(after.invoice.state).toBe('Paid')
    expect(after.invoice.total_amount).toBe(before.invoice.total_amount)
    expect(after.invoice.paid_amount).toBe(before.invoice.paid_amount)
    expect(after.lines).toEqual(before.lines)
    expect(after.invoice.metadata.adjustedByInvoiceIds).toEqual([
      result.adjustmentInvoiceId,
    ])

    const adjustment = await ctx.pool.query<{
      state: string
      type: string | null
      total_amount: string
      adjustment_for_invoice_id: string | null
      replaces_invoice_id: string | null
      order_id: string | null
      due_at: Date | null
      invoice_calculation_snapshot: { source: string; totals: { totalAmount: string } }
      metadata: { kind: string; amount: string }
    }>(
      `SELECT state, type, total_amount, adjustment_for_invoice_id,
              replaces_invoice_id, order_id, due_at, invoice_calculation_snapshot,
              metadata
         FROM invoices WHERE id = $1`,
      [result.adjustmentInvoiceId],
    )
    expect(adjustment.rows[0]!.state).toBe('Unpaid')
    expect(adjustment.rows[0]!.type).toBe('manual')
    expect(adjustment.rows[0]!.total_amount).toBe('250000')
    expect(adjustment.rows[0]!.adjustment_for_invoice_id).toBe(originalId)
    expect(adjustment.rows[0]!.replaces_invoice_id).toBeNull()
    expect(adjustment.rows[0]!.order_id).toBe(result.orderId)
    expect(adjustment.rows[0]!.due_at).not.toBeNull()
    expect(adjustment.rows[0]!.invoice_calculation_snapshot.totals.totalAmount).toBe(
      '250000',
    )
    expect(adjustment.rows[0]!.metadata.kind).toBe('charge')
    expect(adjustment.rows[0]!.metadata.amount).toBe('250000')

    const issueAudit = await ctx.pool.query<{ n: number }>(
      `SELECT COUNT(*)::int AS n FROM audit_log
        WHERE event = 'invoice.issue'
          AND metadata::jsonb ->> 'invoiceId' = $1`,
      [result.adjustmentInvoiceId],
    )
    expect(issueAudit.rows[0]!.n).toBe(1)
  })

  it('creates a linked credit invoice with abs total and null due_at', async () => {
    const originalId = await insertInvoice({ state: 'Paid' })
    const before = await originalSnapshot(originalId)

    const result = await service.createAdjustmentInvoice({
      originalInvoiceId: originalId,
      amount: -80_000n,
      reason: 'Overbilled usage credit',
      actorUserId: ACTOR_USER_ID,
      now: NOW,
    })

    expect(result.kind).toBe('credit')
    expect(result.amount).toBe(-80_000n)
    expect(result.totalAmount).toBe(80_000n)
    expect(result.dueAt).toBeNull()
    expect(result.adjustmentState).toBe('Unpaid')
    expect(result.originalState).toBe('Paid')

    const after = await originalSnapshot(originalId)
    expect(after.invoice.state).toBe('Paid')
    expect(after.lines).toEqual(before.lines)

    const adjustment = await ctx.pool.query<{
      total_amount: string
      due_at: Date | null
      metadata: { kind: string; amount: string }
    }>(
      `SELECT total_amount, due_at, metadata FROM invoices WHERE id = $1`,
      [result.adjustmentInvoiceId],
    )
    expect(adjustment.rows[0]!.total_amount).toBe('80000')
    expect(adjustment.rows[0]!.due_at).toBeNull()
    expect(adjustment.rows[0]!.metadata.kind).toBe('credit')
    expect(adjustment.rows[0]!.metadata.amount).toBe('-80000')
  })

  it('rejects an unpaid invoice and leaves it untouched', async () => {
    const originalId = await insertInvoice({ state: 'Unpaid', paidAmount: 0n })
    const before = await originalSnapshot(originalId)

    await expect(
      service.createAdjustmentInvoice({
        originalInvoiceId: originalId,
        amount: 10_000n,
        reason: 'Should not apply',
        actorUserId: ACTOR_USER_ID,
        now: NOW,
      }),
    ).rejects.toThrow(ConflictException)

    const after = await originalSnapshot(originalId)
    expect(after.invoice.state).toBe('Unpaid')
    expect(after.invoice.metadata).toEqual(before.invoice.metadata)
    expect(after.lines).toEqual(before.lines)

    const extras = await ctx.pool.query<{ n: number }>(
      `SELECT COUNT(*)::int AS n FROM invoices WHERE adjustment_for_invoice_id = $1`,
      [originalId],
    )
    expect(extras.rows[0]!.n).toBe(0)
  })

  it('throws NotFoundException for a missing original', async () => {
    await expect(
      service.createAdjustmentInvoice({
        originalInvoiceId: '00000000-0000-7000-8000-000000000099',
        amount: 10_000n,
        reason: 'Missing original',
        actorUserId: ACTOR_USER_ID,
        now: NOW,
      }),
    ).rejects.toThrow(NotFoundException)
  })

  it('allows two adjustments on the same order-linked paid original', async () => {
    const orderId = uuidv7()
    await ctx.pool.query(`INSERT INTO orders (id) VALUES ($1)`, [orderId])
    const originalId = await insertInvoice({
      state: 'Paid',
      type: 'manual',
      orderId,
    })

    const charge = await service.createAdjustmentInvoice({
      originalInvoiceId: originalId,
      amount: 40_000n,
      reason: 'First additional charge',
      actorUserId: ACTOR_USER_ID,
      now: NOW,
    })
    const credit = await service.createAdjustmentInvoice({
      originalInvoiceId: originalId,
      amount: -15_000n,
      reason: 'Follow-up credit',
      actorUserId: ACTOR_USER_ID,
      now: NOW,
    })

    expect(charge.orderId).toBe(orderId)
    expect(credit.orderId).toBe(orderId)
    expect(charge.kind).toBe('charge')
    expect(credit.kind).toBe('credit')

    const after = await originalSnapshot(originalId)
    expect(after.invoice.state).toBe('Paid')
    expect(after.invoice.metadata.adjustedByInvoiceIds).toEqual([
      charge.adjustmentInvoiceId,
      credit.adjustmentInvoiceId,
    ])
  })
})
