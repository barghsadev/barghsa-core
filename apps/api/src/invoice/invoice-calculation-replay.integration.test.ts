/**
 * Real-PostgreSQL reproducibility tests (T-04.1.02.09).
 *
 * Issue invoices through the production services, read
 * `invoice_calculation_snapshot` back from JSONB, replay ONLY the stored
 * inputs through `replayInvoiceCalculation`, and assert the recomputed
 * totals match:
 *
 *   1. `snapshot.totals` (the document written at issue time);
 *   2. `invoices.total_amount` (int8);
 *   3. each `invoice_lines.line_total` / `vat_amount` in position order.
 *
 * JSONB round-trip is part of the proof: IRR fields must remain
 * decimal-digit strings (never JSON Numbers) so int8 amounts above
 * `Number.MAX_SAFE_INTEGER` stay exact.
 *
 * Wiring: only `getDbPool()` is stubbed, handing both services the
 * schema-scoped pool of the isolated Testcontainers schema.
 */

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { createIsolatedTestDb, dropTestSchema } from '@barghsa/db/test'
import type { IsolatedTestDb } from '@barghsa/db/test'
import { ManualInvoiceService } from './manual-invoice.service.js'
import { AutoInvoiceService } from './auto-invoice.service.js'
import { InvoiceStateMachineService } from './invoice-state-machine.service.js'
import { InvoiceAuditRepository } from './invoice-audit.repository.js'
import { VatCalculationRepository } from './vat-calculation.repository.js'
import { VatCalculationService } from './vat-calculation.service.js'
import { DueAtCalculationRepository } from './due-at.repository.js'
import { DueAtCalculationService } from './due-at.service.js'
import {
  parseIrrJson,
  parseSnapshotTotals,
  replayInvoiceCalculation,
  type InvoiceCalculationSnapshot,
} from './invoice-calculation-snapshot.js'

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

const USER_ID = 'user-replay-auto'
const ACTOR_USER_ID = 'staff-replay-integration'
const PROFILE_ID = '22222222-2222-7222-8222-222222222222'
const PRODUCT_ID = '11111111-1111-7111-8111-111111111111'
const VAT_CONFIG_ID = '44444444-4444-7444-8444-444444444444'

describe('invoice calculation snapshot replay — real PostgreSQL (T-04.1.02.09)', () => {
  let ctx: IsolatedTestDb
  let manual: ManualInvoiceService
  let auto: AutoInvoiceService

  beforeAll(async () => {
    ctx = await createIsolatedTestDb('test_', 2)
    poolHolder.pool = ctx.pool
    const stateMachine = new InvoiceStateMachineService(new InvoiceAuditRepository())
    const dueAt = new DueAtCalculationService(new DueAtCalculationRepository())
    manual = new ManualInvoiceService(stateMachine, dueAt)
    auto = new AutoInvoiceService(
      stateMachine,
      new VatCalculationService(new VatCalculationRepository()),
      dueAt,
    )

    await ctx.pool.query(readFileSync(UUIDV7_MIGRATION, 'utf-8').trim())
    await ctx.db.execute(`CREATE TYPE invoice_state AS ENUM (
      'Draft', 'Unpaid', 'PaymentUnderReview', 'PartiallyFunded', 'Paid',
      'Overdue', 'Cancelled', 'PartiallyRefunded', 'Refunded'
    )`)
    await ctx.db.execute(`CREATE TABLE IF NOT EXISTS profiles (
      id UUID PRIMARY KEY DEFAULT uuid_generate_v7()
    )`)
    await ctx.db.execute(`CREATE TABLE IF NOT EXISTS users (
      user_id TEXT PRIMARY KEY
    )`)
    await ctx.db.execute(`CREATE TABLE IF NOT EXISTS products (
      id UUID PRIMARY KEY DEFAULT uuid_generate_v7(),
      type TEXT NOT NULL DEFAULT 'electricity',
      system_key TEXT,
      title JSONB,
      price BIGINT,
      status TEXT NOT NULL DEFAULT 'active'
    )`)
    await ctx.db.execute(`CREATE TABLE IF NOT EXISTS orders (
      id UUID PRIMARY KEY DEFAULT uuid_generate_v7(),
      user_id TEXT NOT NULL REFERENCES users(user_id) ON DELETE RESTRICT,
      profile_id UUID NOT NULL REFERENCES profiles(id) ON DELETE RESTRICT,
      product_id UUID NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
      order_type TEXT NOT NULL CHECK (order_type IN ('electricity', 'savings', 'solar')),
      status TEXT NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT', 'PENDING', 'CONFIRMED', 'CANCELLED')),
      snapshot_province_id TEXT NOT NULL,
      snapshot_city_id TEXT NOT NULL,
      snapshot_full_address TEXT NOT NULL,
      snapshot_postal_code TEXT NOT NULL,
      gift_code_id UUID,
      gift_discount_amount BIGINT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`)
    await ctx.db.execute(`CREATE TABLE IF NOT EXISTS vat_configurations (
      id UUID PRIMARY KEY DEFAULT uuid_generate_v7(),
      category TEXT NOT NULL,
      rate INTEGER NOT NULL,
      effective_from TIMESTAMPTZ NOT NULL,
      effective_until TIMESTAMPTZ,
      created_by TEXT NOT NULL REFERENCES users(user_id) ON DELETE RESTRICT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`)
    await ctx.db.execute(`CREATE TABLE IF NOT EXISTS product_vat_overrides (
      id UUID PRIMARY KEY DEFAULT uuid_generate_v7(),
      product_id UUID NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
      vat_config_id UUID NOT NULL REFERENCES vat_configurations(id) ON DELETE RESTRICT,
      effective_from TIMESTAMPTZ NOT NULL,
      effective_until TIMESTAMPTZ,
      created_by TEXT NOT NULL REFERENCES users(user_id) ON DELETE RESTRICT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`)

    await ctx.pool.query(readFileSync(INVOICES_MIGRATION, 'utf-8').trim())
    await ctx.pool.query(readFileSync(PAID_OVERDUE_MIGRATION, 'utf-8').trim())
    await ctx.pool.query(readFileSync(LINES_ITEMS_MIGRATION, 'utf-8').trim())
    await ctx.pool.query(readFileSync(POSITION_MIGRATION, 'utf-8').trim())
    await ctx.pool.query(readFileSync(IDEMPOTENCY_MIGRATION, 'utf-8').trim())
    await ctx.pool.query(readFileSync(CALCULATION_SNAPSHOT_MIGRATION, 'utf-8').trim())
    await ctx.pool.query(readFileSync(DUE_PERIODS_MIGRATION, 'utf-8').trim())
    await ctx.pool.query(readFileSync(AUDIT_LOG_MIGRATION, 'utf-8').trim())

    await ctx.db.execute(
      `INSERT INTO users (user_id) VALUES ('${USER_ID}'), ('${ACTOR_USER_ID}')
       ON CONFLICT (user_id) DO NOTHING`,
    )
    await ctx.db.execute(
      `INSERT INTO profiles (id) VALUES ('${PROFILE_ID}')
       ON CONFLICT (id) DO NOTHING`,
    )
    await ctx.db.execute(
      `INSERT INTO products (id, type, system_key, title, price, status)
       VALUES ('${PRODUCT_ID}', 'electricity', 'thermal_electricity',
               '{"fa":"برق حرارتی","en":"Thermal Electricity"}'::jsonb, 1000000, 'active')
       ON CONFLICT (id) DO NOTHING`,
    )
    await ctx.db.execute(
      `INSERT INTO vat_configurations
         (id, category, rate, effective_from, effective_until, created_by, created_at, updated_at)
       VALUES ('${VAT_CONFIG_ID}', 'electricity', 900,
               '2026-01-01T00:00:00Z', NULL, '${ACTOR_USER_ID}', NOW(), NOW())
       ON CONFLICT (id) DO NOTHING`,
    )
    await ctx.db.execute(
      `INSERT INTO product_vat_overrides
         (id, product_id, vat_config_id, effective_from, effective_until, created_by, created_at, updated_at)
       VALUES ('55555555-5555-7555-8555-555555555555', '${PRODUCT_ID}', '${VAT_CONFIG_ID}',
               '2026-01-01T00:00:00Z', NULL, '${ACTOR_USER_ID}', NOW(), NOW())
       ON CONFLICT (id) DO NOTHING`,
    )
  }, 60_000)

  afterAll(async () => {
    poolHolder.pool = null
    await ctx.pool.end()
    await dropTestSchema(ctx.schemaName)
  })

  async function loadPersisted(invoiceId: string): Promise<{
    totalAmount: string
    snapshot: InvoiceCalculationSnapshot
    lines: Array<{ line_total: string; vat_amount: string }>
  }> {
    const invoiceRow = await ctx.db.execute<{
      total_amount: string
      invoice_calculation_snapshot: InvoiceCalculationSnapshot | null
    }>(
      `SELECT total_amount, invoice_calculation_snapshot
       FROM invoices WHERE id = '${invoiceId}'`,
    )
    const snapshot = invoiceRow.rows[0]!.invoice_calculation_snapshot
    expect(snapshot).not.toBeNull()
    const lineRows = await ctx.db.execute<{
      line_total: string
      vat_amount: string
    }>(
      `SELECT line_total, vat_amount FROM invoice_lines
       WHERE invoice_id = '${invoiceId}' ORDER BY position`,
    )
    return {
      totalAmount: invoiceRow.rows[0]!.total_amount,
      snapshot: snapshot!,
      lines: lineRows.rows,
    }
  }

  function expectIrrStrings(snapshot: InvoiceCalculationSnapshot): void {
    expect(typeof snapshot.inputs.orderDiscount).toBe('string')
    expect(typeof snapshot.totals.totalAmount).toBe('string')
    expect(typeof snapshot.totals.subtotal).toBe('string')
    expect(typeof snapshot.totals.totalVat).toBe('string')
    expect(typeof snapshot.totals.totalDiscount).toBe('string')
    for (const line of snapshot.inputs.lines) {
      expect(typeof line.unitPrice).toBe('string')
    }
    for (const step of snapshot.steps) {
      expect(typeof step.gross).toBe('string')
      expect(typeof step.discount).toBe('string')
      expect(typeof step.lineTotal).toBe('string')
      expect(typeof step.vat.netAmount).toBe('string')
      expect(typeof step.vat.numerator).toBe('string')
      expect(typeof step.vat.result).toBe('string')
    }
  }

  function expectReplayMatchesPersisted(
    snapshot: InvoiceCalculationSnapshot,
    totalAmount: string,
    lines: Array<{ line_total: string; vat_amount: string }>,
  ): void {
    expectIrrStrings(snapshot)
    const replayed = replayInvoiceCalculation(snapshot)
    const totals = parseSnapshotTotals(snapshot.totals)

    expect(replayed.source).toBe(snapshot.source)
    expect(replayed.totalAmount).toBe(totals.totalAmount)
    expect(replayed.subtotal).toBe(totals.subtotal)
    expect(replayed.totalVat).toBe(totals.totalVat)
    expect(replayed.totalDiscount).toBe(totals.totalDiscount)
    expect(replayed.totalAmount.toString()).toBe(totalAmount)
    expect(replayed.lines).toHaveLength(lines.length)
    for (let i = 0; i < lines.length; i++) {
      expect(replayed.lines[i]!.lineTotal.toString()).toBe(lines[i]!.line_total)
      expect(replayed.lines[i]!.vatAmount.toString()).toBe(lines[i]!.vat_amount)
      expect(replayed.lines[i]!.vatAmount.toString()).toBe(snapshot.steps[i]!.vat.result)
    }
  }

  async function insertOrder(
    id: string,
    overrides: { giftCodeId?: string; giftDiscountAmount?: number | bigint } = {},
  ): Promise<void> {
    await ctx.db.execute(
      `INSERT INTO orders
         (id, user_id, profile_id, product_id, order_type, status,
          snapshot_province_id, snapshot_city_id, snapshot_full_address, snapshot_postal_code,
          gift_code_id, gift_discount_amount, created_at, updated_at)
       VALUES ('${id}', '${USER_ID}', '${PROFILE_ID}', '${PRODUCT_ID}',
               'electricity', 'PENDING',
               'prov-1', 'city-1', 'آدرس نمونه', '0000000000',
               ${overrides.giftCodeId !== undefined ? `'${overrides.giftCodeId}'` : 'NULL'},
               ${overrides.giftDiscountAmount !== undefined ? overrides.giftDiscountAmount : 'NULL'},
               NOW(), NOW())
       ON CONFLICT (id) DO NOTHING`,
    )
  }

  it('replays a manual invoice with mixed taxable and non-taxable lines', async () => {
    const result = await manual.createManualInvoice({
      profileId: PROFILE_ID,
      actorUserId: ACTOR_USER_ID,
      lines: [
        { description: 'برق مصرفی — دوره اردیبهشت', quantity: 2, unitPrice: 500_000n, vatRate: 900 },
        {
          description: 'کارمزد اداری (بدون مالیات)',
          quantity: 1,
          unitPrice: 100_000n,
          vatRate: 0,
          isTaxable: false,
        },
      ],
      correlationId: 'corr-replay-manual-01',
    })

    expect(result.totalAmount).toBe(1_190_000n)
    const persisted = await loadPersisted(result.invoiceId)
    expect(persisted.snapshot.source).toBe('manual')
    expectReplayMatchesPersisted(persisted.snapshot, persisted.totalAmount, persisted.lines)
  })

  it('replays exact-half VAT (1 IRR at 50% → 1) from the stored snapshot', async () => {
    const result = await manual.createManualInvoice({
      profileId: PROFILE_ID,
      actorUserId: ACTOR_USER_ID,
      lines: [{ description: 'نیم تومان مالیات', quantity: 1, unitPrice: 1n, vatRate: 5000 }],
    })

    expect(result.totalAmount).toBe(2n)
    const persisted = await loadPersisted(result.invoiceId)
    expect(persisted.snapshot.steps[0]!.vat.roundedUp).toBe(true)
    expectReplayMatchesPersisted(persisted.snapshot, persisted.totalAmount, persisted.lines)
  })

  it('replays the product-requirements half-up example: 10% of 55,055 → 5,506', async () => {
    const result = await manual.createManualInvoice({
      profileId: PROFILE_ID,
      actorUserId: ACTOR_USER_ID,
      lines: [{ description: 'نمونه مالی', quantity: 1, unitPrice: 55_055n, vatRate: 1000 }],
    })

    expect(result.lines[0]!.vatAmount).toBe(5_506n)
    expect(result.totalAmount).toBe(60_561n)
    const persisted = await loadPersisted(result.invoiceId)
    expectReplayMatchesPersisted(persisted.snapshot, persisted.totalAmount, persisted.lines)
  })

  it('replays an int8 amount above Number.MAX_SAFE_INTEGER after JSONB round-trip', async () => {
    const unitPrice = 9_007_199_254_740_993n
    const result = await manual.createManualInvoice({
      profileId: PROFILE_ID,
      actorUserId: ACTOR_USER_ID,
      lines: [{ description: 'مبلغ بزرگ', quantity: 1, unitPrice, vatRate: 900 }],
    })

    const persisted = await loadPersisted(result.invoiceId)
    expect(typeof persisted.snapshot.inputs.lines[0]!.unitPrice).toBe('string')
    expect(parseIrrJson(persisted.snapshot.inputs.lines[0]!.unitPrice)).toBe(unitPrice)
    expect(result.lines[0]!.lineTotal).toBe(unitPrice)
    expectReplayMatchesPersisted(persisted.snapshot, persisted.totalAmount, persisted.lines)
  })

  it('replays an auto invoice: VAT on gross, no gift discount', async () => {
    const orderId = 'aaaaaaaa-aaaa-7aaa-8aaa-aaaaaaaaaaa1'
    await insertOrder(orderId)

    const result = await auto.createInvoiceForOrder({
      orderId,
      actorUserId: ACTOR_USER_ID,
      now: new Date('2026-08-01T10:00:00.000Z'),
    })

    expect(result.totalAmount).toBe(1_090_000n)
    const persisted = await loadPersisted(result.invoiceId)
    expect(persisted.snapshot.source).toBe('auto')
    expect(persisted.snapshot.inputs.orderDiscount).toBe('0')
    expectReplayMatchesPersisted(persisted.snapshot, persisted.totalAmount, persisted.lines)
  })

  it('replays an auto invoice with gift-code discount applied before VAT', async () => {
    const orderId = 'bbbbbbbb-bbbb-7bbb-8bbb-bbbbbbbbbb02'
    await insertOrder(orderId, {
      giftCodeId: '66666666-6666-7666-8666-666666666666',
      giftDiscountAmount: 250_000,
    })

    const result = await auto.createInvoiceForOrder({
      orderId,
      actorUserId: ACTOR_USER_ID,
      now: new Date('2026-08-01T10:00:00.000Z'),
    })

    expect(result.totalAmount).toBe(817_500n)
    const persisted = await loadPersisted(result.invoiceId)
    expect(parseIrrJson(persisted.snapshot.inputs.orderDiscount)).toBe(250_000n)
    expectReplayMatchesPersisted(persisted.snapshot, persisted.totalAmount, persisted.lines)
  })
})
