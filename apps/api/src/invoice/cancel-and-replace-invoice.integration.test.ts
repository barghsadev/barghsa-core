/**
 * Real-PostgreSQL integration tests for CancelAndReplaceInvoiceService
 * (T-04.1.05.02).
 *
 * Proves against actual PostgreSQL:
 *   1. Unpaid invoice with paid_amount = 0 is cancelled and a linked
 *      replacement is issued with `replaces_invoice_id` set.
 *   2. New lines persist with computed totals / VAT / position.
 *   3. Confirmed payment is rejected and leaves the original untouched.
 *   4. Errors roll back both the cancel and the replacement insert.
 */

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import { ConflictException, NotFoundException } from '@nestjs/common'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { v7 as uuidv7 } from 'uuid'
import { createIsolatedTestDb, dropTestSchema } from '@barghsa/db/test'
import type { IsolatedTestDb } from '@barghsa/db/test'
import { CancelAndReplaceInvoiceService } from './cancel-and-replace-invoice.service.js'
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

const PROFILE_ID = '33333333-3333-7333-8333-333333333333'
const ACTOR_USER_ID = 'staff-cancel-replace'
const ISSUED = new Date('2026-08-01T10:00:00.000Z')
const DUE = new Date('2026-08-08T10:00:00.000Z')
const NOW = new Date('2026-08-02T12:00:00.000Z')

describe('CancelAndReplaceInvoiceService — real PostgreSQL (T-04.1.05.02)', () => {
  let ctx: IsolatedTestDb
  let service: CancelAndReplaceInvoiceService

  beforeAll(async () => {
    ctx = await createIsolatedTestDb('test_', 2)
    poolHolder.pool = ctx.pool
    service = new CancelAndReplaceInvoiceService(
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
    withOrder?: boolean
  }): Promise<string> {
    const id = uuidv7()
    let orderId: string | null = null
    if (opts.withOrder !== false) {
      orderId = uuidv7()
      await ctx.pool.query(`INSERT INTO orders (id) VALUES ($1)`, [orderId])
    }
    await ctx.pool.query(
      `INSERT INTO invoices
         (id, profile_id, order_id, type, state, total_amount, paid_amount,
          issued_at, payable_from, due_at, metadata)
       VALUES ($1, $2, $3, $4, $5, 1090000, $6, $7, $7, $8, $9::jsonb)`,
      [
        id,
        PROFILE_ID,
        orderId,
        opts.type ?? 'auto',
        opts.state,
        opts.paidAmount ?? 0n,
        ISSUED,
        DUE,
        JSON.stringify({ source: opts.type ?? 'auto' }),
      ],
    )
    return id
  }

  it('cancels an unpaid invoice and issues a linked replacement', async () => {
    const originalId = await insertInvoice({ state: 'Unpaid' })

    const result = await service.cancelAndReplaceInvoice({
      invoiceId: originalId,
      reason: 'Quantity was billed as 1 instead of 2',
      newLines: [
        { description: 'برق مصرفی — اصلاح شده', quantity: 2, unitPrice: 500_000n, vatRate: 900 },
        { description: 'کارمزد اداری', quantity: 1, unitPrice: 50_000n, vatRate: 0, isTaxable: false },
      ],
      actorUserId: ACTOR_USER_ID,
      correlationId: 'corr-replace-01',
      ip: '10.0.0.4',
      now: NOW,
    })

    // 2 × 500,000 = 1,000,000 + VAT 90,000; 50,000 non-taxable
    expect(result.totalAmount).toBe(1_140_000n)
    expect(result.originalInvoiceId).toBe(originalId)
    expect(result.originalState).toBe('Cancelled')
    expect(result.replacesInvoiceId).toBe(originalId)
    expect(result.replacementState).toBe('Unpaid')
    const originalOrder = await ctx.pool.query<{ order_id: string | null }>(
      `SELECT order_id FROM invoices WHERE id = $1`,
      [originalId],
    )
    expect(result.orderId).toBe(originalOrder.rows[0]!.order_id)
    expect(result.orderId).not.toBeNull()
    expect(result.lines).toHaveLength(2)
    expect(result.lines[0]!.vatAmount).toBe(90_000n)
    expect(result.lines[1]!.vatAmount).toBe(0n)
    expect(result.issuedAt.toISOString()).toBe(NOW.toISOString())

    const original = await ctx.pool.query<{
      state: string
      cancelled_at: Date | null
      paid_amount: string
      metadata: Record<string, unknown>
    }>(
      `SELECT state, cancelled_at, paid_amount, metadata FROM invoices WHERE id = $1`,
      [originalId],
    )
    expect(original.rows[0]!.state).toBe('Cancelled')
    expect(original.rows[0]!.cancelled_at).not.toBeNull()
    expect(original.rows[0]!.paid_amount).toBe('0')
    expect(original.rows[0]!.metadata.replacedByInvoiceId).toBe(result.replacementInvoiceId)
    expect(original.rows[0]!.metadata.replacementReason).toBe(
      'Quantity was billed as 1 instead of 2',
    )

    const replacement = await ctx.pool.query<{
      state: string
      type: string | null
      replaces_invoice_id: string | null
      order_id: string | null
      invoice_calculation_snapshot: { source: string; totals: { totalAmount: string } }
    }>(
      `SELECT state, type, replaces_invoice_id, order_id, invoice_calculation_snapshot
         FROM invoices WHERE id = $1`,
      [result.replacementInvoiceId],
    )
    expect(replacement.rows[0]!.state).toBe('Unpaid')
    expect(replacement.rows[0]!.type).toBe('manual')
    expect(replacement.rows[0]!.replaces_invoice_id).toBe(originalId)
    expect(replacement.rows[0]!.order_id).toBe(result.orderId)
    expect(replacement.rows[0]!.invoice_calculation_snapshot.totals.totalAmount).toBe(
      '1140000',
    )

    const cancelAudit = await ctx.pool.query<{ n: number }>(
      `SELECT COUNT(*)::int AS n FROM audit_log
        WHERE event = 'invoice.cancel'
          AND metadata::jsonb ->> 'invoiceId' = $1`,
      [originalId],
    )
    expect(cancelAudit.rows[0]!.n).toBe(1)

    const issueAudit = await ctx.pool.query<{ n: number }>(
      `SELECT COUNT(*)::int AS n FROM audit_log
        WHERE event = 'invoice.issue'
          AND metadata::jsonb ->> 'invoiceId' = $1`,
      [result.replacementInvoiceId],
    )
    expect(issueAudit.rows[0]!.n).toBe(1)
  })

  it('replaces an Overdue unpaid invoice', async () => {
    const originalId = await insertInvoice({ state: 'Overdue' })
    const result = await service.cancelAndReplaceInvoice({
      invoiceId: originalId,
      reason: 'Correct overdue invoice before payment',
      newLines: [
        { description: 'اصلاح', quantity: 1, unitPrice: 100_000n, vatRate: 0, isTaxable: false },
      ],
      actorUserId: ACTOR_USER_ID,
      now: NOW,
    })
    expect(result.originalState).toBe('Cancelled')
    expect(result.replacementState).toBe('Unpaid')
    expect(result.replacesInvoiceId).toBe(originalId)
  })

  it('rejects a missing invoice', async () => {
    await expect(
      service.cancelAndReplaceInvoice({
        invoiceId: uuidv7(),
        reason: 'Does not exist',
        newLines: [
          { description: 'x', quantity: 1, unitPrice: 1000n, vatRate: 0, isTaxable: false },
        ],
        actorUserId: ACTOR_USER_ID,
      }),
    ).rejects.toThrow(NotFoundException)
  })

  it('rejects a paid invoice and leaves it unchanged', async () => {
    const originalId = await insertInvoice({
      state: 'PartiallyFunded',
      paidAmount: 100_000n,
    })

    await expect(
      service.cancelAndReplaceInvoice({
        invoiceId: originalId,
        reason: 'Tried to replace after payment',
        newLines: [
          { description: 'x', quantity: 1, unitPrice: 1000n, vatRate: 0, isTaxable: false },
        ],
        actorUserId: ACTOR_USER_ID,
        now: NOW,
      }),
    ).rejects.toThrow(ConflictException)

    const original = await ctx.pool.query<{
      state: string
      paid_amount: string
      cancelled_at: Date | null
    }>(`SELECT state, paid_amount, cancelled_at FROM invoices WHERE id = $1`, [originalId])
    expect(original.rows[0]!.state).toBe('PartiallyFunded')
    expect(original.rows[0]!.paid_amount).toBe('100000')
    expect(original.rows[0]!.cancelled_at).toBeNull()

    const extras = await ctx.pool.query<{ n: number }>(
      `SELECT COUNT(*)::int AS n FROM invoices WHERE replaces_invoice_id = $1`,
      [originalId],
    )
    expect(extras.rows[0]!.n).toBe(0)
  })

  it('does not write when the reason is empty', async () => {
    const originalId = await insertInvoice({ state: 'Unpaid' })
    await expect(
      service.cancelAndReplaceInvoice({
        invoiceId: originalId,
        reason: '  ',
        newLines: [
          { description: 'x', quantity: 1, unitPrice: 1000n, vatRate: 0, isTaxable: false },
        ],
        actorUserId: ACTOR_USER_ID,
      }),
    ).rejects.toThrow()

    const original = await ctx.pool.query<{ state: string }>(
      `SELECT state FROM invoices WHERE id = $1`,
      [originalId],
    )
    expect(original.rows[0]!.state).toBe('Unpaid')
  })

  it('rolls back the cancel when the audit actor is missing', async () => {
    const originalId = await insertInvoice({ state: 'Unpaid' })
    await expect(
      service.cancelAndReplaceInvoice({
        invoiceId: originalId,
        reason: 'Corrected lines',
        newLines: [
          { description: 'x', quantity: 1, unitPrice: 1000n, vatRate: 0, isTaxable: false },
        ],
        actorUserId: 'missing-staff',
        now: NOW,
      }),
    ).rejects.toThrow()

    const original = await ctx.pool.query<{
      state: string
      cancelled_at: Date | null
    }>(`SELECT state, cancelled_at FROM invoices WHERE id = $1`, [originalId])
    expect(original.rows[0]!.state).toBe('Unpaid')
    expect(original.rows[0]!.cancelled_at).toBeNull()

    const extras = await ctx.pool.query<{ n: number }>(
      `SELECT COUNT(*)::int AS n FROM invoices WHERE replaces_invoice_id = $1`,
      [originalId],
    )
    expect(extras.rows[0]!.n).toBe(0)
  })
})
