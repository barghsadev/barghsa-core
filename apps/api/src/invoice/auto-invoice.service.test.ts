/**
 * Unit tests for AutoInvoiceService (T-04.1.02.03).
 *
 * Mocks `getDbPool` from @barghsa/db and verifies the order→invoice flow:
 * order/product loading, snapshot metadata, VAT rate resolution (explicit
 * override + DB fallback), gift-discount math, state-machine Issue on the
 * SAME client (tx join — no nested BEGIN/COMMIT when a client is passed),
 * and rollback on failure.
 *
 * The mocked DB is stateful: INSERT statements feed the read-back SELECTs,
 * so the service's read-your-own-writes path sees exactly what it wrote
 * (mirroring the real PostgreSQL behavior the integration test proves).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { BadRequestException, NotFoundException, ConflictException } from '@nestjs/common'
import { AutoInvoiceService } from './auto-invoice.service.js'
import { InvoiceStateMachineService } from './invoice-state-machine.service.js'
import { InvoiceAuditRepository } from './invoice-audit.repository.js'
import { VatCalculationRepository } from './vat-calculation.repository.js'
import { VatCalculationService } from './vat-calculation.service.js'
import { DueAtCalculationRepository } from './due-at.repository.js'
import { DueAtCalculationService } from './due-at.service.js'

// ---- Mocks ----
const mockClient = {
  query: vi.fn(),
  release: vi.fn(),
}

const mockPool = {
  connect: vi.fn().mockResolvedValue(mockClient),
  query: vi.fn(),
}

vi.mock('@barghsa/db', () => ({
  getDbPool: () => mockPool,
}))

vi.mock('uuid', () => ({
  v7: vi.fn((() => {
    let n = 0
    return () => `00000000-0000-7000-8000-00000000000${n++}`
  })()),
}))

const ORDER_ID = '33333333-3333-7333-8333-333333333333'
const PROFILE_ID = '22222222-2222-7222-8222-222222222222'
const PRODUCT_ID = '11111111-1111-7111-8111-111111111111'
const ACTOR = 'order-actor-001'

// ---- Stateful mock DB ------------------------------------------------------
interface MockLine {
  id: string
  description: string
  quantity: number
  unit_price: string
  line_total: string
  vat_rate: number
  vat_amount: string
  is_taxable: boolean
  position: number
}

interface MockItem {
  id: string
  product_id: string
  product_title: { fa?: string | null; en?: string | null } | null
  quantity: number
  unit_price: string
  vat_rate: number
}

interface MockInvoice {
  total_amount: string
  due_at: Date | null
}

const db = {
  order: {
    id: ORDER_ID,
    profile_id: PROFILE_ID,
    product_id: PRODUCT_ID,
    order_type: 'electricity',
    status: 'DRAFT',
    gift_code_id: null as string | null,
    gift_discount_amount: null as string | null,
    created_at: new Date('2026-08-01T10:00:00.000Z'),
  },
  product: {
    id: PRODUCT_ID,
    type: 'electricity',
    system_key: 'thermal_electricity',
    title: { fa: 'برق حرارتی', en: 'Thermal Electricity' },
    price: '1000000' as string | null,
  },
  /** VAT category rate lookup result (rows), null → fallback 0%. */
  categoryVatRows: [] as Array<{ rate: number }>,
  /** VAT product override lookup result (rows). */
  overrideVatRows: [] as Array<{ rate: number }>,
  invoices: [] as MockInvoice[],
  lines: [] as MockLine[],
  items: [] as MockItem[],
  invoiceState: 'Draft' as string,
}

function resetDb() {
  db.order = {
    id: ORDER_ID,
    profile_id: PROFILE_ID,
    product_id: PRODUCT_ID,
    order_type: 'electricity',
    status: 'DRAFT',
    gift_code_id: null,
    gift_discount_amount: null,
    created_at: new Date('2026-08-01T10:00:00.000Z'),
  }
  db.product = {
    id: PRODUCT_ID,
    type: 'electricity',
    system_key: 'thermal_electricity',
    title: { fa: 'برق حرارتی', en: 'Thermal Electricity' },
    price: '1000000',
  }
  db.categoryVatRows = []
  db.overrideVatRows = []
  db.invoices = []
  db.lines = []
  db.items = []
  db.invoiceState = 'Draft'
}

/** Wire the mocked client to the stateful in-memory DB. */
function installDbHandler() {
  mockClient.query.mockImplementation(async (sql: string, params?: unknown[]) => {
    const s = sql.trim()
    // Order lookup
    if (s.startsWith('SELECT id, profile_id, product_id')) {
      return db.order ? { rows: [db.order] } : { rows: [] }
    }
    // Idempotency guard
    if (s.startsWith('SELECT id FROM invoices') && s.includes('order_id')) {
      return { rows: [] }
    }
    // Product lookup
    if (s.startsWith('SELECT id, type, system_key')) {
      return db.product ? { rows: [db.product] } : { rows: [] }
    }
    // VAT override lookup
    if (s.includes('FROM product_vat_overrides')) {
      return { rows: db.overrideVatRows }
    }
    // VAT category lookup
    if (s.startsWith('SELECT rate') && s.includes('FROM vat_configurations')) {
      return { rows: db.categoryVatRows }
    }
    // Invoice insert
    if (s.startsWith('INSERT INTO invoices')) {
      db.invoices.push({
        total_amount: String(params![3]),
        due_at: params![4] as Date,
      })
      db.invoiceState = 'Draft'
      return { rows: [] }
    }
    // Line insert
    if (s.startsWith('INSERT INTO invoice_lines')) {
      db.lines.push({
        id: params![0] as string,
        description: params![2] as string,
        quantity: params![3] as number,
        unit_price: String(params![4]),
        line_total: String(params![5]),
        vat_rate: params![6] as number,
        vat_amount: String(params![7]),
        is_taxable: params![8] as boolean,
        position: params![9] as number,
      })
      return { rows: [] }
    }
    // Item insert
    if (s.startsWith('INSERT INTO invoice_items')) {
      db.items.push({
        id: params![0] as string,
        product_id: params![2] as string,
        product_title: (params![3] as string | null)
          ? (JSON.parse(params![3] as string) as { fa?: string | null; en?: string | null })
          : null,
        quantity: params![4] as number,
        unit_price: String(params![5]),
        vat_rate: params![6] as number,
      })
      return { rows: [] }
    }
    // State machine: lock row
    if (s.startsWith('SELECT id, state')) {
      return { rows: [{ id: 'inv', state: db.invoiceState }] }
    }
    // State machine: apply update
    if (s.startsWith('UPDATE invoices')) {
      db.invoiceState = 'Unpaid'
      return { rows: [] }
    }
    // State machine: audit insert
    if (s.startsWith('INSERT INTO audit_log')) {
      return { rows: [] }
    }
    // Read-back: invoice row
    if (s.startsWith('SELECT id, order_id, profile_id')) {
      const inv = db.invoices[0]
      return {
        rows: [{
          id: '00000000-0000-7000-8000-000000000001',
          order_id: db.order.id,
          profile_id: db.order.profile_id,
          state: db.invoiceState,
          total_amount: inv?.total_amount ?? '0',
          issued_at: new Date('2026-08-01T10:00:00.000Z'),
          payable_from: new Date('2026-08-01T10:00:00.000Z'),
          due_at: inv?.due_at ?? null,
        }],
      }
    }
    // Read-back: lines
    if (s.startsWith('SELECT id, description')) {
      return { rows: db.lines }
    }
    // Read-back: items
    if (s.startsWith('SELECT id, product_id, product_title')) {
      return { rows: db.items }
    }
    return { rows: [] }
  })
}

function command(overrides: Record<string, unknown> = {}) {
  return {
    orderId: ORDER_ID,
    actorUserId: ACTOR,
    now: new Date('2026-08-01T10:00:00.000Z'),
    ...overrides,
  }
}

describe('AutoInvoiceService', () => {
  let service: AutoInvoiceService

  beforeEach(() => {
    vi.clearAllMocks()
    resetDb()
    installDbHandler()
    const stateMachine = new InvoiceStateMachineService(new InvoiceAuditRepository())
    service = new AutoInvoiceService(
      stateMachine,
      new VatCalculationService(new VatCalculationRepository()),
      new DueAtCalculationService(new DueAtCalculationRepository()),
    )
    mockPool.connect.mockResolvedValue(mockClient)
    mockClient.release.mockImplementation(() => {})
  })

  describe('createInvoiceForOrder (standalone, owns its transaction)', () => {
    it('creates and issues the invoice atomically on one client', async () => {
      // A category default of 9% exists → VAT resolves from category.
      db.categoryVatRows = [{ rate: 900 }]

      const result = await service.createInvoiceForOrder(command())

      expect(result.orderId).toBe(ORDER_ID)
      expect(result.state).toBe('Unpaid')
      // 1,000,000 × 9% = 90,000 VAT → total 1,090,000
      expect(result.totalAmount).toBe(1_090_000n)
      expect(result.lines[0]!.vatRate).toBe(900)
      expect(result.lines[0]!.vatAmount).toBe(90_000n)
      expect(result.transition.transition).toBe('Issue')
      // Product composition snapshot was written
      expect(result.items).toHaveLength(1)
      expect(result.items[0]!.productId).toBe(PRODUCT_ID)

      // Atomicity: exactly one BEGIN and one COMMIT on the same client
      const calls = mockClient.query.mock.calls.map((c) => (c[0] as string).trim().split(/\s+/)[0]!.toUpperCase())
      expect(calls.filter((c) => c === 'BEGIN')).toHaveLength(1)
      expect(calls.filter((c) => c === 'COMMIT')).toHaveLength(1)
      expect(mockPool.connect).toHaveBeenCalledTimes(1)
      expect(mockClient.release).toHaveBeenCalledTimes(1)
      // Read-back happens BEFORE COMMIT (read-your-own-writes)
      const readIdx = mockClient.query.mock.calls.findIndex(
        (c) => (c[0] as string).startsWith('SELECT id, order_id, profile_id'),
      )
      const commitIdx = mockClient.query.mock.calls.findIndex(
        (c) => (c[0] as string) === 'COMMIT',
      )
      expect(readIdx).toBeGreaterThanOrEqual(0)
      expect(commitIdx).toBeGreaterThan(readIdx)

      const insertCall = mockClient.query.mock.calls.find(
        (c) => (c[0] as string).startsWith('INSERT INTO invoices'),
      )
      expect(insertCall![0] as string).toContain('invoice_calculation_snapshot')
      const snapshot = JSON.parse(insertCall![1]![6] as string) as {
        version: number
        source: string
        steps: Array<{ vat: { result: string } }>
        totals: { totalAmount: string }
      }
      expect(snapshot.version).toBe(1)
      expect(snapshot.source).toBe('auto')
      expect(snapshot.steps[0]!.vat.result).toBe('90000')
      expect(snapshot.totals.totalAmount).toBe('1090000')
    })

    it('applies an explicit VAT rate and the gift discount before VAT', async () => {
      db.order.gift_code_id = '00000000-0000-7000-8000-000000000099'
      db.order.gift_discount_amount = '250000'

      const result = await service.createInvoiceForOrder(
        command({ vatRateBasisPoints: 900 }),
      )

      // Unit price 1,000,000 − 250,000 discount = 750,000 net; VAT 9% = 67,500
      expect(result.totalDiscount).toBe(250_000n)
      expect(result.lines[0]!.lineTotal).toBe(750_000n)
      expect(result.lines[0]!.vatAmount).toBe(67_500n)
      expect(result.totalAmount).toBe(817_500n)
      expect(result.lines[0]!.vatRate).toBe(900)

      // Snapshot metadata carries VAT source + gift discount
      const insertCall = mockClient.query.mock.calls.find(
        (c) => (c[0] as string).startsWith('INSERT INTO invoices'),
      )
      const metadata = JSON.parse(insertCall![1]![5] as string) as {
        snapshot: {
          vat: { source: string; rateBasisPoints: number }
          gift: { discountAmount: string; giftCodeId: string | null }
        }
      }
      expect(metadata.snapshot.vat.source).toBe('explicit')
      expect(metadata.snapshot.vat.rateBasisPoints).toBe(900)
      expect(metadata.snapshot.gift.discountAmount).toBe('250000')
      expect(metadata.snapshot.gift.giftCodeId).toBe(db.order.gift_code_id)

      const calcSnapshot = JSON.parse(insertCall![1]![6] as string) as {
        inputs: { orderDiscount: string }
        steps: Array<{ discount: string; lineTotal: string; vat: { result: string } }>
        totals: { totalDiscount: string; totalAmount: string }
      }
      expect(calcSnapshot.inputs.orderDiscount).toBe('250000')
      expect(calcSnapshot.steps[0]!.discount).toBe('250000')
      expect(calcSnapshot.steps[0]!.lineTotal).toBe('750000')
      expect(calcSnapshot.steps[0]!.vat.result).toBe('67500')
      expect(calcSnapshot.totals.totalDiscount).toBe('250000')
      expect(calcSnapshot.totals.totalAmount).toBe('817500')
    })

    it('resolves the VAT rate from an active product override', async () => {
      db.overrideVatRows = [{ rate: 900 }]

      const result = await service.createInvoiceForOrder(command())

      expect(result.lines[0]!.vatRate).toBe(900)
      expect(result.lines[0]!.vatAmount).toBe(90_000n)

      const insertCall = mockClient.query.mock.calls.find(
        (c) => (c[0] as string).startsWith('INSERT INTO invoices'),
      )
      const metadata = JSON.parse(insertCall![1]![5] as string) as {
        snapshot: { vat: { source: string } }
      }
      expect(metadata.snapshot.vat.source).toBe('product_override')
    })

    it('falls back to 0% VAT when no override or category rate exists', async () => {
      const result = await service.createInvoiceForOrder(command())

      expect(result.lines[0]!.vatRate).toBe(0)
      expect(result.lines[0]!.vatAmount).toBe(0n)
      expect(result.totalAmount).toBe(1_000_000n)

      const insertCall = mockClient.query.mock.calls.find(
        (c) => (c[0] as string).startsWith('INSERT INTO invoices'),
      )
      const metadata = JSON.parse(insertCall![1]![5] as string) as {
        snapshot: { vat: { source: string } }
      }
      expect(metadata.snapshot.vat.source).toBe('fallback_zero')
    })

    it('throws NotFoundException for a missing order', async () => {
      db.order = null as unknown as typeof db.order

      await expect(
        service.createInvoiceForOrder(command()),
      ).rejects.toThrow(NotFoundException)

      const calls = mockClient.query.mock.calls.map((c) => (c[0] as string).trim().split(/\s+/)[0]!.toUpperCase())
      expect(calls).toContain('ROLLBACK')
      expect(calls).not.toContain('COMMIT')
    })

    it('throws BadRequestException for a cancelled order', async () => {
      db.order.status = 'CANCELLED'

      await expect(
        service.createInvoiceForOrder(command()),
      ).rejects.toThrow(BadRequestException)
    })

    it('throws BadRequestException when the product has no price', async () => {
      db.product.price = null

      await expect(
        service.createInvoiceForOrder(command()),
      ).rejects.toThrow(BadRequestException)
    })

    it('throws BadRequestException when the gift discount exceeds the line', async () => {
      db.order.gift_discount_amount = '2000000'

      await expect(
        service.createInvoiceForOrder(command()),
      ).rejects.toThrow(BadRequestException)
    })

    it('throws ConflictException when the order already has an auto invoice', async () => {
      // The idempotency guard SELECT returns an existing invoice.
      mockClient.query.mockImplementation(async (sql: string) => {
        const s = sql.trim()
        if (s.startsWith('SELECT id FROM invoices') && s.includes('order_id')) {
          return { rows: [{ id: 'existing-invoice' }] }
        }
        if (s.startsWith('SELECT id, profile_id, product_id')) return { rows: [db.order] }
        return { rows: [] }
      })

      await expect(
        service.createInvoiceForOrder(command()),
      ).rejects.toThrow(ConflictException)
    })

    it('throws BadRequestException for a dueAt in the past', async () => {
      await expect(
        service.createInvoiceForOrder(
          command({ dueAt: new Date('2026-07-01T00:00:00.000Z') }),
        ),
      ).rejects.toThrow(BadRequestException)
      expect(mockPool.connect).not.toHaveBeenCalled()
    })

    it('rolls back when the Issue transition fails', async () => {
      // Break the state-machine UPDATE
      mockClient.query.mockImplementation(async (sql: string) => {
        const s = sql.trim()
        if (s.startsWith('UPDATE invoices')) throw new Error('DB down')
        if (s.startsWith('SELECT id, profile_id, product_id')) return { rows: [db.order] }
        if (s.startsWith('SELECT id FROM invoices') && s.includes('order_id')) return { rows: [] }
        if (s.startsWith('SELECT id, type, system_key')) return { rows: [db.product] }
        if (s.startsWith('SELECT rate') || s.includes('product_vat_overrides')) return { rows: [] }
        if (s.startsWith('INSERT INTO invoices')) return { rows: [] }
        if (s.startsWith('INSERT INTO invoice_lines')) return { rows: [] }
        if (s.startsWith('INSERT INTO invoice_items')) return { rows: [] }
        if (s.startsWith('SELECT id, state')) return { rows: [{ id: 'inv', state: 'Draft' }] }
        if (s.startsWith('INSERT INTO audit_log')) return { rows: [] }
        return { rows: [] }
      })

      await expect(
        service.createInvoiceForOrder(command()),
      ).rejects.toThrow('DB down')

      const calls = mockClient.query.mock.calls.map((c) => (c[0] as string).trim().split(/\s+/)[0]!.toUpperCase())
      expect(calls).toContain('ROLLBACK')
      expect(calls).not.toContain('COMMIT')
    })
  })

  describe('createInvoiceForOrder (joins a caller-owned transaction)', () => {
    it('never opens its own connection or BEGIN/COMMIT/ROLLBACK when a client is passed', async () => {
      db.categoryVatRows = [{ rate: 900 }]

      const calls: string[] = []
      mockClient.query.mockImplementation(async (sql: string, params?: unknown[]) => {
        calls.push(sql.trim().split(/\s+/)[0]!.toUpperCase())
        const s = sql.trim()
        if (s.startsWith('SELECT id, profile_id, product_id')) return { rows: [db.order] }
        if (s.startsWith('SELECT id FROM invoices') && s.includes('order_id')) return { rows: [] }
        if (s.startsWith('SELECT id, type, system_key')) return { rows: [db.product] }
        if (s.includes('product_vat_overrides')) return { rows: [] }
        if (s.startsWith('SELECT rate') && s.includes('vat_configurations')) return { rows: [{ rate: 900 }] }
        if (s.startsWith('INSERT INTO invoices')) {
          db.invoices.push({ total_amount: String(params![3]), due_at: params![4] as Date })
          return { rows: [] }
        }
        if (s.startsWith('INSERT INTO invoice_lines')) {
          db.lines.push({
            id: params![0] as string,
            description: params![2] as string,
            quantity: params![3] as number,
            unit_price: String(params![4]),
            line_total: String(params![5]),
            vat_rate: params![6] as number,
            vat_amount: String(params![7]),
            is_taxable: params![8] as boolean,
            position: params![9] as number,
          })
          return { rows: [] }
        }
        if (s.startsWith('INSERT INTO invoice_items')) return { rows: [] }
        if (s.startsWith('SELECT id, state')) {
          db.invoiceState = 'Unpaid'
          return { rows: [{ id: 'inv', state: 'Draft' }] }
        }
        if (s.startsWith('UPDATE invoices')) return { rows: [] }
        if (s.startsWith('INSERT INTO audit_log')) return { rows: [] }
        if (s.startsWith('SELECT id, order_id, profile_id')) {
          return {
            rows: [{
              id: '00000000-0000-7000-8000-000000000001',
              order_id: db.order.id,
              profile_id: db.order.profile_id,
              state: 'Unpaid',
              total_amount: db.invoices[0]?.total_amount ?? '0',
              issued_at: new Date('2026-08-01T10:00:00.000Z'),
              payable_from: new Date('2026-08-01T10:00:00.000Z'),
              due_at: db.invoices[0]?.due_at ?? null,
            }],
          }
        }
        if (s.startsWith('SELECT id, description')) return { rows: db.lines }
        if (s.startsWith('SELECT id, product_id, product_title')) return { rows: db.items }
        return { rows: [] }
      })

      const incomingClient = {
        query: mockClient.query,
      }

      const result = await service.createInvoiceForOrder(
        command({ client: incomingClient }),
      )

      expect(result.state).toBe('Unpaid')
      expect(result.totalAmount).toBe(1_090_000n)
      expect(calls).not.toContain('BEGIN')
      expect(calls).not.toContain('COMMIT')
      expect(calls).not.toContain('ROLLBACK')
      expect(mockPool.connect).not.toHaveBeenCalled()
      expect(mockClient.release).not.toHaveBeenCalled()
      // The state machine joined the same client — no second connection
    })
  })
})
