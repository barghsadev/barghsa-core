/**
 * Unit tests for CreateAdjustmentInvoiceService (T-04.1.05.03).
 *
 * Mocks `getDbPool` and verifies: paid lock → linked Draft insert with
 * `adjustment_for_invoice_id` → issue on the SAME client → COMMIT.
 * Covers charge vs credit, no-payment / state / reason / zero-amount
 * validation, and rollback. The original's state and amounts are never
 * rewritten (metadata-only update).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common'
import {
  CreateAdjustmentInvoiceService,
  CREATE_ADJUSTMENT_ERRORS,
  isAdjustableInvoiceState,
  adjustmentKindForAmount,
  ADJUSTABLE_INVOICE_STATES,
} from './create-adjustment-invoice.service.js'
import { InvoiceStateMachineService } from './invoice-state-machine.service.js'
import { InvoiceAuditRepository } from './invoice-audit.repository.js'
import { DueAtCalculationRepository } from './due-at.repository.js'
import { DueAtCalculationService } from './due-at.service.js'

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

function mockQuery(handler: (sql: string, params?: unknown[]) => unknown) {
  mockClient.query.mockImplementation(async (sql: string, params?: unknown[]) =>
    handler(sql, params),
  )
}

function originalRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'inv-original',
    profile_id: 'profile-001',
    order_id: 'order-001',
    contract_id: 'contract-001',
    consultation_id: null,
    type: 'auto',
    state: 'Paid',
    total_amount: '1090000',
    paid_amount: '1090000',
    refunded_amount: '0',
    metadata: { source: 'auto' },
    ...overrides,
  }
}

function command(overrides: Record<string, unknown> = {}) {
  return {
    originalInvoiceId: 'inv-original',
    amount: 250_000n,
    reason: 'Post-payment quantity increase',
    actorUserId: 'staff-001',
    now: new Date('2026-08-01T10:00:00.000Z'),
    ...overrides,
  }
}

function adjustmentExcerpt(overrides: Record<string, unknown> = {}) {
  return {
    id: '00000000-0000-7000-8000-000000000001',
    profile_id: 'profile-001',
    order_id: 'order-001',
    contract_id: 'contract-001',
    consultation_id: null,
    state: 'Unpaid',
    total_amount: '250000',
    issued_at: new Date('2026-08-01T10:00:00.000Z'),
    payable_from: new Date('2026-08-01T10:00:00.000Z'),
    due_at: new Date('2026-08-08T10:00:00.000Z'),
    adjustment_for_invoice_id: 'inv-original',
    ...overrides,
  }
}

describe('isAdjustableInvoiceState', () => {
  it('accepts only post-payment Paid / PartiallyFunded / PartiallyRefunded / Refunded', () => {
    expect(ADJUSTABLE_INVOICE_STATES).toEqual([
      'Paid',
      'PartiallyFunded',
      'PartiallyRefunded',
      'Refunded',
    ])
    expect(isAdjustableInvoiceState('Paid')).toBe(true)
    expect(isAdjustableInvoiceState('PartiallyFunded')).toBe(true)
    expect(isAdjustableInvoiceState('PartiallyRefunded')).toBe(true)
    expect(isAdjustableInvoiceState('Refunded')).toBe(true)
    expect(isAdjustableInvoiceState('Draft')).toBe(false)
    expect(isAdjustableInvoiceState('Unpaid')).toBe(false)
    expect(isAdjustableInvoiceState('Overdue')).toBe(false)
    expect(isAdjustableInvoiceState('Cancelled')).toBe(false)
    expect(isAdjustableInvoiceState('PaymentUnderReview')).toBe(false)
  })
})

describe('adjustmentKindForAmount', () => {
  it('maps positive to charge and negative to credit', () => {
    expect(adjustmentKindForAmount(1n)).toBe('charge')
    expect(adjustmentKindForAmount(-1n)).toBe('credit')
  })
})

describe('CreateAdjustmentInvoiceService', () => {
  let service: CreateAdjustmentInvoiceService

  beforeEach(() => {
    vi.clearAllMocks()
    service = new CreateAdjustmentInvoiceService(
      new InvoiceStateMachineService(new InvoiceAuditRepository()),
      new DueAtCalculationService(new DueAtCalculationRepository()),
    )
    mockPool.connect.mockResolvedValue(mockClient)
    mockClient.release.mockImplementation(() => {})
  })

  function happyPathHandler(excerpt = adjustmentExcerpt()) {
    return (sql: string) => {
      if (sql.includes('paid_amount') && sql.includes('FOR UPDATE')) {
        return { rows: [originalRow()] }
      }
      if (sql.includes('FROM service_due_periods')) return { rows: [] }
      if (sql.startsWith('INSERT INTO invoices')) return { rows: [] }
      if (sql.startsWith('INSERT INTO invoice_lines')) return { rows: [] }
      if (sql.startsWith('SELECT id, state FROM invoices')) {
        return {
          rows: [{
            id: '00000000-0000-7000-8000-000000000001',
            state: 'Draft',
          }],
        }
      }
      if (sql.startsWith('UPDATE invoices SET state')) return { rows: [] }
      if (sql.startsWith('UPDATE invoices') && sql.includes('metadata')) return { rows: [] }
      if (sql.startsWith('INSERT INTO audit_log')) return { rows: [] }
      if (sql.includes('adjustment_for_invoice_id') && sql.startsWith('SELECT id, profile_id')) {
        return { rows: [excerpt] }
      }
      if (sql.startsWith('SELECT id, description')) {
        return {
          rows: [{
            id: '00000000-0000-7000-8000-000000000001',
            description: 'Post-payment quantity increase',
            quantity: 1,
            unit_price: excerpt.total_amount,
            line_total: excerpt.total_amount,
            vat_rate: 0,
            vat_amount: '0',
            is_taxable: false,
            position: 0,
          }],
        }
      }
      return { rows: [] }
    }
  }

  it('issues a linked additional-charge invoice atomically', async () => {
    const calls: string[] = []
    const handler = happyPathHandler()
    mockQuery((sql) => {
      calls.push(sql.trim().split(/\s+/)[0]!.toUpperCase())
      return handler(sql)
    })

    const result = await service.createAdjustmentInvoice(command())

    expect(result.originalInvoiceId).toBe('inv-original')
    expect(result.originalState).toBe('Paid')
    expect(result.adjustmentForInvoiceId).toBe('inv-original')
    expect(result.adjustmentState).toBe('Unpaid')
    expect(result.kind).toBe('charge')
    expect(result.amount).toBe(250_000n)
    expect(result.totalAmount).toBe(250_000n)
    expect(result.orderId).toBe('order-001')
    expect(result.issueTransition.transition).toBe('Issue')

    expect(calls.filter((c) => c === 'BEGIN')).toHaveLength(1)
    expect(calls.filter((c) => c === 'COMMIT')).toHaveLength(1)
    expect(mockPool.connect).toHaveBeenCalledTimes(1)
    expect(mockClient.release).toHaveBeenCalledTimes(1)

    const insertCall = mockClient.query.mock.calls.find(
      (c) => (c[0] as string).startsWith('INSERT INTO invoices'),
    )
    expect(insertCall).toBeDefined()
    expect(insertCall![0] as string).toContain('adjustment_for_invoice_id')
    expect(insertCall![0] as string).not.toContain('replaces_invoice_id')
    const params = insertCall![1] as unknown[]
    const adjustmentId = params[0]
    expect(result.adjustmentInvoiceId).toBe(adjustmentId)
    expect(params[params.length - 1]).toBe('inv-original')
    expect(insertCall![0] as string).toContain("'manual'")
    const snapshot = JSON.parse(params[8] as string) as {
      source: string
      totals: { totalAmount: string }
    }
    expect(snapshot.source).toBe('manual')
    expect(snapshot.totals.totalAmount).toBe('250000')

    const originalUpdates = mockClient.query.mock.calls.filter(
      (c) => (c[0] as string).startsWith('UPDATE invoices'),
    )
    const stateUpdates = originalUpdates.filter(
      (c) => (c[0] as string).includes('SET state'),
    )
    expect(stateUpdates).toHaveLength(1)
    expect((stateUpdates[0]![1] as unknown[])[0]).toBe(adjustmentId)

    const metadataUpdate = originalUpdates.find(
      (c) => (c[0] as string).includes('metadata'),
    )
    expect(metadataUpdate).toBeDefined()
    const meta = JSON.parse((metadataUpdate![1] as unknown[])[0] as string) as {
      adjustedByInvoiceIds: string[]
      source: string
    }
    expect(meta.source).toBe('auto')
    expect(meta.adjustedByInvoiceIds).toEqual([adjustmentId])
  })

  it('stores a credit as a non-negative total with null due_at', async () => {
    mockQuery(
      happyPathHandler(
        adjustmentExcerpt({
          total_amount: '80000',
          due_at: null,
        }),
      ),
    )

    const result = await service.createAdjustmentInvoice(
      command({ amount: -80_000n, reason: 'Overbilled usage credit' }),
    )

    expect(result.kind).toBe('credit')
    expect(result.amount).toBe(-80_000n)
    expect(result.totalAmount).toBe(80_000n)
    expect(result.dueAt).toBeNull()

    const insertCall = mockClient.query.mock.calls.find(
      (c) => (c[0] as string).startsWith('INSERT INTO invoices'),
    )
    const params = insertCall![1] as unknown[]
    expect(params[5]).toBe(80_000n)
    expect(params[6]).toBeNull()
    const metadata = JSON.parse(params[7] as string) as {
      kind: string
      amount: string
    }
    expect(metadata.kind).toBe('credit')
    expect(metadata.amount).toBe('-80000')

    const dueLookups = mockClient.query.mock.calls.filter(
      (c) => (c[0] as string).includes('FROM service_due_periods'),
    )
    expect(dueLookups).toHaveLength(0)
  })

  it('rejects an empty reason without opening a connection', async () => {
    await expect(
      service.createAdjustmentInvoice(command({ reason: '   ' })),
    ).rejects.toThrow(BadRequestException)
    expect(mockPool.connect).not.toHaveBeenCalled()
  })

  it('rejects a zero amount without opening a connection', async () => {
    await expect(
      service.createAdjustmentInvoice(command({ amount: 0n })),
    ).rejects.toThrow(CREATE_ADJUSTMENT_ERRORS.AMOUNT_ZERO())
    expect(mockPool.connect).not.toHaveBeenCalled()
  })

  it('throws NotFoundException when the original is missing and rolls back', async () => {
    mockQuery((sql) => {
      if (sql.includes('FOR UPDATE')) return { rows: [] }
      return { rows: [] }
    })

    await expect(service.createAdjustmentInvoice(command())).rejects.toThrow(
      NotFoundException,
    )
    const calls = mockClient.query.mock.calls.map(
      (c) => (c[0] as string).trim().split(/\s+/)[0]!.toUpperCase(),
    )
    expect(calls).toContain('ROLLBACK')
    expect(calls).not.toContain('COMMIT')
  })

  it('rejects an unpaid invoice with ConflictException', async () => {
    mockQuery((sql) => {
      if (sql.includes('paid_amount') && sql.includes('FOR UPDATE')) {
        return { rows: [originalRow({ paid_amount: '0', state: 'Unpaid' })] }
      }
      return { rows: [] }
    })

    const rejection = service.createAdjustmentInvoice(command())
    await expect(rejection).rejects.toThrow(ConflictException)
    await expect(rejection).rejects.toThrow(
      CREATE_ADJUSTMENT_ERRORS.NO_PAYMENT('inv-original'),
    )
    const calls = mockClient.query.mock.calls.map(
      (c) => (c[0] as string).trim().split(/\s+/)[0]!.toUpperCase(),
    )
    expect(calls).toContain('ROLLBACK')
    expect(calls).not.toContain('COMMIT')
  })

  it('rejects a cancelled invoice even when it has confirmed payment', async () => {
    mockQuery((sql) => {
      if (sql.includes('paid_amount') && sql.includes('FOR UPDATE')) {
        return {
          rows: [originalRow({ state: 'Cancelled', paid_amount: '500000' })],
        }
      }
      return { rows: [] }
    })

    await expect(service.createAdjustmentInvoice(command())).rejects.toThrow(
      CREATE_ADJUSTMENT_ERRORS.STATE_NOT_ADJUSTABLE('inv-original', 'Cancelled'),
    )
  })

  it('rolls back when the issue transition fails', async () => {
    mockQuery((sql) => {
      if (sql.includes('paid_amount') && sql.includes('FOR UPDATE')) {
        return { rows: [originalRow()] }
      }
      if (sql.includes('FROM service_due_periods')) return { rows: [] }
      if (sql.startsWith('INSERT INTO invoices')) return { rows: [] }
      if (sql.startsWith('INSERT INTO invoice_lines')) return { rows: [] }
      if (sql.startsWith('SELECT id, state FROM invoices')) {
        return { rows: [{ id: '00000000-0000-7000-8000-000000000001', state: 'Draft' }] }
      }
      if (sql.startsWith('UPDATE invoices SET state')) throw new Error('DB down')
      return { rows: [] }
    })

    await expect(service.createAdjustmentInvoice(command())).rejects.toThrow('DB down')
    const calls = mockClient.query.mock.calls.map(
      (c) => (c[0] as string).trim().split(/\s+/)[0]!.toUpperCase(),
    )
    expect(calls).toContain('ROLLBACK')
    expect(calls).not.toContain('COMMIT')
  })
})
