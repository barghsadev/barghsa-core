/**
 * Real-PostgreSQL integration tests for AutoInvoiceService (T-04.1.02.03).
 *
 * Runs the actual service against a Testcontainers-managed PostgreSQL 17
 * instance (migrations 0052 → 0053 → 0054 → 0055 + audit_log) and proves:
 *
 *   1. Order → invoice creation is ATOMIC: the invoice, its lines, its
 *      product-composition items and the audit entry land in ONE
 *      transaction; a caller-provided client joins that transaction.
 *   2. The invoice is `Unpaid` with issuedAt/payableFrom/dueAt set and the
 *      canonical `invoice.issue` audit entry written exactly once.
 *   3. Snapshot semantics: product price/title/type + VAT rate + gift-code
 *      discount are frozen at creation time (metadata + invoice_items).
 *   4. VAT is applied on the NET taxable amount (after the pre-VAT gift
 *      discount), half-up rounded to the nearest IRR.
 *   5. Failures roll back everything (no orphan Draft, no lines, no items,
 *      no audit row); duplicates are rejected while the order is intact.
 *
 * Wiring: only `getDbPool()` is stubbed, handing the service the
 * schema-scoped pool of the isolated Testcontainers schema.
 */

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import { ConflictException, NotFoundException } from '@nestjs/common'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { createIsolatedTestDb, dropTestSchema } from '@barghsa/db/test'
import type { IsolatedTestDb } from '@barghsa/db/test'
import { AutoInvoiceService } from './auto-invoice.service.js'
import { InvoiceStateMachineService } from './invoice-state-machine.service.js'
import { InvoiceAuditRepository } from './invoice-audit.repository.js'
import { VatCalculationRepository } from './vat-calculation.repository.js'
import { VatCalculationService } from './vat-calculation.service.js'
import { calculateAutoInvoice } from './auto-invoice.calculation.js'

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
const AUDIT_LOG_MIGRATION = resolve(
  __dirname,
  '../../../../packages/db/drizzle/0005_create_audit_log.sql',
)

const USER_ID = 'user-integration-auto'
const ACTOR_USER_ID = 'staff-integration-auto'
const PROFILE_ID = '22222222-2222-7222-8222-222222222222'
const PRODUCT_ID = '11111111-1111-7111-8111-111111111111'
const ORDER_ID = '33333333-3333-7333-8333-333333333333'
const VAT_CONFIG_ID = '44444444-4444-7444-8444-444444444444'

describe('AutoInvoiceService — real PostgreSQL integration (T-04.1.02.03)', () => {
  let ctx: IsolatedTestDb
  let service: AutoInvoiceService

  beforeAll(async () => {
    ctx = await createIsolatedTestDb('test_', 2)
    poolHolder.pool = ctx.pool
    service = new AutoInvoiceService(
      new InvoiceStateMachineService(new InvoiceAuditRepository()),
      new VatCalculationService(new VatCalculationRepository()),
    )

    // --- DDL: uuid v7 fn, enum, minimal FK targets, then the order and
    // product tables exactly as the service reads them, migrations
    // 0052 → 0053 → 0054 → 0055 plus audit_log.
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
    // Products: the columns the service snapshots (type/title/price).
    await ctx.db.execute(`CREATE TABLE IF NOT EXISTS products (
      id UUID PRIMARY KEY DEFAULT uuid_generate_v7(),
      type TEXT NOT NULL DEFAULT 'electricity',
      system_key TEXT,
      title JSONB,
      price BIGINT,
      status TEXT NOT NULL DEFAULT 'active'
    )`)
    // Orders: the columns the service reads (incl. gift-code mirror cols).
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
    // VAT config + product override tables for the resolution seam.
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
    await ctx.pool.query(readFileSync(AUDIT_LOG_MIGRATION, 'utf-8').trim())

    // --- Seed data: user, profile, product, VAT config + override, order.
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
    await ctx.db.execute(
      `INSERT INTO orders
         (id, user_id, profile_id, product_id, order_type, status,
          snapshot_province_id, snapshot_city_id, snapshot_full_address, snapshot_postal_code,
          created_at, updated_at)
       VALUES ('${ORDER_ID}', '${USER_ID}', '${PROFILE_ID}', '${PRODUCT_ID}',
               'electricity', 'PENDING',
               'prov-1', 'city-1', 'تهران، خیابان آزادی، پلاک ۱۲', '1234567890',
               NOW(), NOW())
       ON CONFLICT (id) DO NOTHING`,
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

  async function insertOrder(
    id: string,
    overrides: Record<string, unknown> = {},
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

  it('creates + issues an order invoice atomically with VAT + items', async () => {
    const orderId = 'aaaaaaaa-aaaa-7aaa-8aaa-aaaaaaaaaaa1'
    await insertOrder(orderId)

    const result = await service.createInvoiceForOrder({
      orderId,
      actorUserId: ACTOR_USER_ID,
      correlationId: 'corr-auto-01',
      reason: 'Auto invoice from order submission (integration test)',
      ip: '10.0.0.3',
      now: new Date('2026-08-01T10:00:00.000Z'),
    })

    // Override is active → 9% VAT on 1,000,000 gross = 90,000
    expect(result.state).toBe('Unpaid')
    expect(result.orderId).toBe(orderId)
    expect(result.profileId).toBe(PROFILE_ID)
    expect(result.totalAmount).toBe(1_090_000n)
    expect(result.lines).toHaveLength(1)
    expect(result.lines[0]!.vatRate).toBe(900)
    expect(result.lines[0]!.vatAmount).toBe(90_000n)
    expect(result.lines[0]!.description).toBe('برق حرارتی')
    // Product identity is merged from the calculation (not fabricated).
    expect(result.lines[0]!.productId).toBe(PRODUCT_ID)
    expect(result.lines[0]!.productType).toBe('electricity')
    expect(result.items).toHaveLength(1)
    expect(result.items[0]!.productId).toBe(PRODUCT_ID)
    expect(result.transition.transition).toBe('Issue')

    // --- Verify the stored invoice row is linked to the order
    const invoiceRow = await ctx.db.execute<{
      order_id: string | null
      state: string
      total_amount: string
      issued_at: Date | null
      payable_from: Date | null
      due_at: Date | null
      metadata: Record<string, unknown> | null
    }>(`SELECT order_id, state, total_amount, issued_at, payable_from, due_at, metadata
        FROM invoices WHERE id = '${result.invoiceId}'`)
    expect(invoiceRow.rows[0]!.order_id).toBe(orderId)
    expect(invoiceRow.rows[0]!.state).toBe('Unpaid')
    expect(invoiceRow.rows[0]!.total_amount).toBe('1090000')
    expect(invoiceRow.rows[0]!.issued_at).not.toBeNull()
    expect(invoiceRow.rows[0]!.payable_from).not.toBeNull()
    expect(invoiceRow.rows[0]!.due_at).not.toBeNull()

    // --- Snapshot metadata: product composition + VAT source
    const meta = invoiceRow.rows[0]!.metadata as Record<string, unknown>
    const snapshot = meta.snapshot as {
      product: { id: string; type: string; systemKey: string }
      vat: { source: string; rateBasisPoints: number }
      terms: { orderType: string }
    }
    expect(meta.source).toBe('auto')
    expect(snapshot.product.id).toBe(PRODUCT_ID)
    expect(snapshot.product.systemKey).toBe('thermal_electricity')
    expect(snapshot.vat.source).toBe('product_override')
    expect(snapshot.vat.rateBasisPoints).toBe(900)
    expect(snapshot.terms.orderType).toBe('electricity')

    // --- invoice_items carry the frozen product composition
    const itemRows = await ctx.db.execute<{
      product_id: string
      unit_price: string
      vat_rate: number
      quantity: number
      product_title: Record<string, unknown>
    }>(`SELECT product_id, unit_price, vat_rate, quantity, product_title
        FROM invoice_items WHERE invoice_id = '${result.invoiceId}'`)
    expect(itemRows.rows).toHaveLength(1)
    expect(itemRows.rows[0]!.product_id).toBe(PRODUCT_ID)
    expect(itemRows.rows[0]!.unit_price).toBe('1000000')
    expect(itemRows.rows[0]!.vat_rate).toBe(900)
    expect(itemRows.rows[0]!.product_title).toEqual({
      fa: 'برق حرارتی',
      en: 'Thermal Electricity',
    })

    // --- Exactly one canonical audit entry (invoice.issue)
    expect(await countAuditRows(result.invoiceId)).toBe(1)
  })

  it('applies the gift-code discount before VAT', async () => {
    const orderId = 'bbbbbbbb-bbbb-7bbb-8bbb-bbbbbbbbbb02'
    await insertOrder(orderId, {
      giftCodeId: '66666666-6666-7666-8666-666666666666',
      giftDiscountAmount: 250000,
    })

    const result = await service.createInvoiceForOrder({
      orderId,
      actorUserId: ACTOR_USER_ID,
      now: new Date('2026-08-01T10:00:00.000Z'),
    })

    // Gross 1,000,000 − 250,000 discount = 750,000 net; VAT 9% = 67,500
    expect(result.totalDiscount).toBe(250_000n)
    expect(result.lines[0]!.lineTotal).toBe(750_000n)
    expect(result.lines[0]!.vatAmount).toBe(67_500n)
    expect(result.totalAmount).toBe(817_500n)

    const meta = (await ctx.db.execute<{ metadata: Record<string, unknown> | null }>(
      `SELECT metadata FROM invoices WHERE id = '${result.invoiceId}'`,
    )).rows[0]!.metadata as Record<string, unknown>
    const snapshot = meta.snapshot as {
      gift: { giftCodeId: string; discountAmount: string }
    }
    expect(snapshot.gift.giftCodeId).toBe('66666666-6666-7666-8666-666666666666')
    expect(snapshot.gift.discountAmount).toBe('250000')
  })

  it('does not roll back the order for a 100%-coverage gift discount', async () => {
    // fixed_irr caps a code at min(value, orderAmount): a gift discount
    // equal to the product price (1,000,000) yields a 0-total invoice —
    // the order must still be created, not aborted.
    const orderId = 'a1a1a1a1-a1a1-7a1a-8a1a-a1a1a1a1a1a9'
    await insertOrder(orderId, {
      giftCodeId: '88888888-8888-7888-8888-888888888888',
      giftDiscountAmount: 1_000_000,
    })

    const result = await service.createInvoiceForOrder({
      orderId,
      actorUserId: ACTOR_USER_ID,
      vatRateBasisPoints: 900,
      now: new Date('2026-08-01T10:00:00.000Z'),
    })

    // lineTotal 0, VAT 0, total 0 — a legitimate fully-discounted invoice.
    expect(result.totalAmount).toBe(0n)
    expect(result.totalDiscount).toBe(1_000_000n)
    expect(result.lines[0]!.lineTotal).toBe(0n)
    expect(result.lines[0]!.vatAmount).toBe(0n)
    expect(result.state).toBe('Unpaid')

    // The order row still exists (nothing rolled back).
    const orderStillThere = (await ctx.db.execute<{ n: number }>(
      `SELECT COUNT(*)::int AS n FROM orders WHERE id = '${orderId}'`,
    )).rows[0]!.n
    expect(orderStillThere).toBe(1)
    const invoiceCount = (await ctx.db.execute<{ n: number }>(
      `SELECT COUNT(*)::int AS n FROM invoices WHERE order_id = '${orderId}'`,
    )).rows[0]!.n
    expect(invoiceCount).toBe(1)
  })

  it('rejects a duplicate auto invoice for the same order (409)', async () => {
    const orderId = 'cccccccc-cccc-7ccc-8ccc-cccccccccc03'
    await insertOrder(orderId)

    await service.createInvoiceForOrder({
      orderId,
      actorUserId: ACTOR_USER_ID,
    })

    await expect(
      service.createInvoiceForOrder({
        orderId,
        actorUserId: ACTOR_USER_ID,
      }),
    ).rejects.toThrow(ConflictException)

    const count = (await ctx.db.execute<{ n: number }>(
      `SELECT COUNT(*)::int AS n FROM invoices WHERE order_id = '${orderId}'`,
    )).rows[0]!.n
    expect(count).toBe(1)
  })

  it('throws NotFoundException for a missing order', async () => {
    const missing = 'dddddddd-dddd-7ddd-8ddd-dddddddddd04'
    await expect(
      service.createInvoiceForOrder({
        orderId: missing,
        actorUserId: ACTOR_USER_ID,
      }),
    ).rejects.toThrow(NotFoundException)

    const orphans = (await ctx.db.execute<{ n: number }>(
      `SELECT COUNT(*)::int AS n FROM invoices WHERE order_id = '${missing}'`,
    )).rows[0]!.n
    expect(orphans).toBe(0)
  })

  it('rolls back every row when the audit insert fails mid-transaction', async () => {
    const orderId = 'eeeeeeee-eeee-7eee-8eee-eeeeeeeeee05'
    await insertOrder(orderId)

    const before = {
      invoices: (await ctx.db.execute<{ n: number }>(`SELECT COUNT(*)::int AS n FROM invoices`)).rows[0]!.n,
      lines: (await ctx.db.execute<{ n: number }>(`SELECT COUNT(*)::int AS n FROM invoice_lines`)).rows[0]!.n,
      items: (await ctx.db.execute<{ n: number }>(`SELECT COUNT(*)::int AS n FROM invoice_items`)).rows[0]!.n,
      audit: (await ctx.db.execute<{ n: number }>(`SELECT COUNT(*)::int AS n FROM audit_log`)).rows[0]!.n,
    }

    // Break the audit_log FK: an actor with no users row fails the
    // transition's audit insert → everything must roll back.
    await expect(
      service.createInvoiceForOrder({
        orderId,
        actorUserId: 'ghost-actor-no-users-row',
      }),
    ).rejects.toThrow()

    const after = {
      invoices: (await ctx.db.execute<{ n: number }>(`SELECT COUNT(*)::int AS n FROM invoices`)).rows[0]!.n,
      lines: (await ctx.db.execute<{ n: number }>(`SELECT COUNT(*)::int AS n FROM invoice_lines`)).rows[0]!.n,
      items: (await ctx.db.execute<{ n: number }>(`SELECT COUNT(*)::int AS n FROM invoice_items`)).rows[0]!.n,
      audit: (await ctx.db.execute<{ n: number }>(`SELECT COUNT(*)::int AS n FROM audit_log`)).rows[0]!.n,
    }
    expect(after.invoices).toBe(before.invoices)
    expect(after.lines).toBe(before.lines)
    expect(after.items).toBe(before.items)
    expect(after.audit).toBe(before.audit)

    // No Draft may linger for the order
    const drafts = await ctx.db.execute<{ n: number }>(
      `SELECT COUNT(*)::int AS n FROM invoices
       WHERE order_id = '${orderId}' AND state = 'Draft'`,
    )
    expect(drafts.rows[0]!.n).toBe(0)
  })

  it('joins a caller-owned transaction: rollback of the caller rolls back the invoice', async () => {
    const orderId = 'ffffffff-ffff-7fff-8fff-ffffffffff06'
    await insertOrder(orderId)

    // The caller opens the transaction, passes its client, then rolls back.
    const client = await ctx.pool.connect()
    try {
      await client.query('BEGIN')
      const result = await service.createInvoiceForOrder({
        orderId,
        actorUserId: ACTOR_USER_ID,
        client,
      })
      expect(result.state).toBe('Unpaid')
      // Invoice visible inside the transaction (read-your-own-writes).
      // Must query on the SAME client — ctx.db uses another connection
      // that cannot see this transaction's uncommitted rows.
      const inside = (await client.query<{ n: number }>(
        `SELECT COUNT(*)::int AS n FROM invoices WHERE order_id = $1`,
        [orderId],
      )).rows[0]!.n
      expect(inside).toBe(1)
      await client.query('ROLLBACK')
    } finally {
      client.release()
    }

    // The caller's rollback removed the invoice entirely.
    const outside = (await ctx.db.execute<{ n: number }>(
      `SELECT COUNT(*)::int AS n FROM invoices WHERE order_id = '${orderId}'`,
    )).rows[0]!.n
    expect(outside).toBe(0)
  })

  it('defaults dueAt to issuedAt + 7 days', async () => {
    const orderId = 'b0b0b0b0-b0b0-7b0b-8b0b-b0b0b0b0b007'
    await insertOrder(orderId)

    const result = await service.createInvoiceForOrder({
      orderId,
      actorUserId: ACTOR_USER_ID,
      now: new Date('2026-08-01T10:00:00.000Z'),
    })
    const due = new Date(result.dueAt!).getTime()
    const issued = new Date(result.issuedAt).getTime()
    expect(due - issued).toBe(7 * 24 * 60 * 60 * 1000)
  })

  it('production parity: same totals as the pure calculation module', async () => {
    const orderId = 'c1c1c1c1-c1c1-7c1c-8c1c-c1c1c1c1c108'
    await insertOrder(orderId, {
      giftCodeId: '77777777-7777-7777-8777-777777777777',
      giftDiscountAmount: 100000,
    })

    const result = await service.createInvoiceForOrder({
      orderId,
      actorUserId: ACTOR_USER_ID,
      vatRateBasisPoints: 900,
      now: new Date('2026-08-01T10:00:00.000Z'),
    })

    const pure = calculateAutoInvoice(
      [
        {
          productId: PRODUCT_ID,
          productType: 'electricity',
          productTitle: { fa: 'برق حرارتی', en: 'Thermal Electricity' },
          quantity: 1,
          unitPrice: 1_000_000n,
          vatRate: 900,
        },
      ],
      100_000n,
    )

    expect(result.totalAmount).toBe(pure.totalAmount)
    expect(result.lines[0]!.lineTotal).toBe(pure.lines[0]!.lineTotal)
    expect(result.lines[0]!.vatAmount).toBe(pure.lines[0]!.vatAmount)
    // Net 900,000 + 9% VAT 81,000 = 981,000
    expect(result.totalAmount).toBe(981_000n)
  })
})
