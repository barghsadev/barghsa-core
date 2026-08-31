/**
 * Unit tests for CancelAndReplaceInvoiceService (T-04.1.05.02).
 *
 * Mocks `getDbPool` and verifies: unpaid lock → cancel → linked Draft
 * insert with `replaces_invoice_id` → issue on the SAME client → COMMIT.
 * Also covers no-payment / state / reason / line validation and rollback.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common'
import {
  CancelAndReplaceInvoiceService,
  CANCEL_AND_REPLACE_ERRORS,
  isReplaceableInvoiceState,
  REPLACEABLE_INVOICE_STATES,
} from './cancel-and-replace-invoice.service.js'
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
    state: 'Unpaid',
    total_amount: '1090000',
    paid_amount: '0',
    refunded_amount: '0',
    metadata: { source: 'auto' },
    ...overrides,
  }
}

function command(overrides: Record<string, unknown> = {}) {
  return {
    invoiceId: 'inv-original',
    reason: 'Wrong quantity on the issued lines',
    newLines: [
      { description: 'برق مصرفی — اصلاح شده', quantity: 2, unitPrice: 1_000_000n, vatRate: 900 },
    ],
    actorUserId: 'staff-001',
    now: new Date('2026-08-01T10:00:00.000Z'),
    ...overrides,
  }
}

describe('isReplaceableInvoiceState', () => {
  it('accepts only unpaid Draft / Unpaid / Overdue', () => {
    expect(REPLACEABLE_INVOICE_STATES).toEqual(['Draft', 'Unpaid', 'Overdue'])
    expect(isReplaceableInvoiceState('Draft')).toBe(true)
    expect(isReplaceableInvoiceState('Unpaid')).toBe(true)
    expect(isReplaceableInvoiceState('Overdue')).toBe(true)
    expect(isReplaceableInvoiceState('Paid')).toBe(false)
    expect(isReplaceableInvoiceState('PartiallyFunded')).toBe(false)
    expect(isReplaceableInvoiceState('PaymentUnderReview')).toBe(false)
    expect(isReplaceableInvoiceState('Cancelled')).toBe(false)
  })
})

describe('CancelAndReplaceInvoiceService', () => {
  let service: CancelAndReplaceInvoiceService

  beforeEach(() => {
    vi.clearAllMocks()
    service = new CancelAndReplaceInvoiceService(
      new InvoiceStateMachineService(new InvoiceAuditRepository()),
      new DueAtCalculationService(new DueAtCalculationRepository()),
    )
    mockPool.connect.mockResolvedValue(mockClient)
    mockClient.release.mockImplementation(() => {})
  })

  it('cancels the original and issues a linked replacement atomically', async () => {
    const calls: string[] = []
    let lockCount = 0
    mockQuery((sql) => {
      calls.push(sql.trim().split(/\s+/)[0]!.toUpperCase())
      if (sql.includes('paid_amount') && sql.includes('FOR UPDATE')) {
        return { rows: [originalRow()] }
      }
      if (sql.includes('FROM service_due_periods')) return { rows: [] }
      if (sql.startsWith('INSERT INTO invoices')) return { rows: [] }
      if (sql.startsWith('INSERT INTO invoice_lines')) return { rows: [] }
      if (sql.startsWith('SELECT id, state FROM invoices')) {
        lockCount += 1
        return {
          rows: [{
            id: lockCount === 1 ? 'inv-original' : '00000000-0000-7000-8000-000000000001',
            state: lockCount === 1 ? 'Unpaid' : 'Draft',
          }],
        }
      }
      if (sql.startsWith('UPDATE invoices SET state')) return { rows: [] }
      if (sql.startsWith('UPDATE invoices') && sql.includes('metadata')) return { rows: [] }
      if (sql.startsWith('INSERT INTO audit_log')) return { rows: [] }
      if (sql.includes('replaces_invoice_id') && sql.startsWith('SELECT id, profile_id')) {
        return {
          rows: [{
            id: '00000000-0000-7000-8000-000000000001',
            profile_id: 'profile-001',
            order_id: 'order-001',
            contract_id: 'contract-001',
            consultation_id: null,
            state: 'Unpaid',
            total_amount: '2180000',
            issued_at: new Date('2026-08-01T10:00:00.000Z'),
            payable_from: new Date('2026-08-01T10:00:00.000Z'),
            due_at: new Date('2026-08-08T10:00:00.000Z'),
            replaces_invoice_id: 'inv-original',
          }],
        }
      }
      if (sql.startsWith('SELECT id, description')) {
        return {
          rows: [{
            id: '00000000-0000-7000-8000-000000000001',
            description: 'برق مصرفی — اصلاح شده',
            quantity: 2,
            unit_price: '1000000',
            line_total: '2000000',
            vat_rate: 900,
            vat_amount: '180000',
            is_taxable: true,
            position: 0,
          }],
        }
      }
      return { rows: [] }
    })

    const result = await service.cancelAndReplaceInvoice(command())

    expect(result.originalInvoiceId).toBe('inv-original')
    expect(result.originalState).toBe('Cancelled')
    expect(result.replacementInvoiceId).toBe('00000000-0000-7000-8000-000000000001')
    expect(result.replacesInvoiceId).toBe('inv-original')
    expect(result.replacementState).toBe('Unpaid')
    expect(result.totalAmount).toBe(2_180_000n)
    expect(result.orderId).toBe('order-001')
    expect(result.cancelTransition.transition).toBe('Cancel')
    expect(result.issueTransition.transition).toBe('Issue')

    expect(calls.filter((c) => c === 'BEGIN')).toHaveLength(1)
    expect(calls.filter((c) => c === 'COMMIT')).toHaveLength(1)
    expect(mockPool.connect).toHaveBeenCalledTimes(1)
    expect(mockClient.release).toHaveBeenCalledTimes(1)

    const insertCall = mockClient.query.mock.calls.find(
      (c) => (c[0] as string).startsWith('INSERT INTO invoices'),
    )
    expect(insertCall).toBeDefined()
    expect(insertCall![0] as string).toContain('replaces_invoice_id')
    const params = insertCall![1] as unknown[]
    expect(params[params.length - 1]).toBe('inv-original')
    expect(insertCall![0] as string).toContain("'manual'")
    const snapshot = JSON.parse(params[8] as string) as {
      source: string
      totals: { totalAmount: string }
    }
    expect(snapshot.source).toBe('manual')
    expect(snapshot.totals.totalAmount).toBe('2180000')

    const readIdx = mockClient.query.mock.calls.findIndex(
      (c) => (c[0] as string).includes('replaces_invoice_id')
        && (c[0] as string).startsWith('SELECT id, profile_id'),
    )
    const commitIdx = mockClient.query.mock.calls.findIndex(
      (c) => (c[0] as string) === 'COMMIT',
    )
    expect(readIdx).toBeGreaterThanOrEqual(0)
    expect(commitIdx).toBeGreaterThan(readIdx)
  })

  it('rejects an empty reason without opening a connection', async () => {
    await expect(
      service.cancelAndReplaceInvoice(command({ reason: '   ' })),
    ).rejects.toThrow(BadRequestException)
    expect(mockPool.connect).not.toHaveBeenCalled()
  })

  it('rejects invalid lines without opening a connection', async () => {
    await expect(
      service.cancelAndReplaceInvoice(
        command({
          newLines: [{ description: 'x', quantity: 0, unitPrice: 100n, vatRate: 0 }],
        }),
      ),
    ).rejects.toThrow(BadRequestException)
    expect(mockPool.connect).not.toHaveBeenCalled()
  })

  it('throws NotFoundException when the original is missing and rolls back', async () => {
    mockQuery((sql) => {
      if (sql.includes('FOR UPDATE')) return { rows: [] }
      return { rows: [] }
    })

    await expect(service.cancelAndReplaceInvoice(command())).rejects.toThrow(
      NotFoundException,
    )
    const calls = mockClient.query.mock.calls.map(
      (c) => (c[0] as string).trim().split(/\s+/)[0]!.toUpperCase(),
    )
    expect(calls).toContain('ROLLBACK')
    expect(calls).not.toContain('COMMIT')
  })

  it('rejects a paid invoice with ConflictException', async () => {
    mockQuery((sql) => {
      if (sql.includes('paid_amount') && sql.includes('FOR UPDATE')) {
        return { rows: [originalRow({ paid_amount: '500000', state: 'PartiallyFunded' })] }
      }
      return { rows: [] }
    })

    const rejection = service.cancelAndReplaceInvoice(command())
    await expect(rejection).rejects.toThrow(ConflictException)
    await expect(rejection).rejects.toThrow(
      CANCEL_AND_REPLACE_ERRORS.HAS_PAYMENT('inv-original', 500_000n),
    )
    const calls = mockClient.query.mock.calls.map(
      (c) => (c[0] as string).trim().split(/\s+/)[0]!.toUpperCase(),
    )
    expect(calls).toContain('ROLLBACK')
    expect(calls).not.toContain('COMMIT')
  })

  it('rejects a Paid invoice even when paid_amount is somehow zero', async () => {
    mockQuery((sql) => {
      if (sql.includes('paid_amount') && sql.includes('FOR UPDATE')) {
        return { rows: [originalRow({ state: 'Paid' })] }
      }
      return { rows: [] }
    })

    await expect(service.cancelAndReplaceInvoice(command())).rejects.toThrow(
      ConflictException,
    )
  })

  it('rolls back when the cancel transition fails', async () => {
    mockQuery((sql) => {
      if (sql.includes('paid_amount') && sql.includes('FOR UPDATE')) {
        return { rows: [originalRow()] }
      }
      if (sql.startsWith('SELECT id, state FROM invoices')) {
        return { rows: [{ id: 'inv-original', state: 'Unpaid' }] }
      }
      if (sql.startsWith('UPDATE invoices SET state')) throw new Error('DB down')
      return { rows: [] }
    })

    await expect(service.cancelAndReplaceInvoice(command())).rejects.toThrow('DB down')
    const calls = mockClient.query.mock.calls.map(
      (c) => (c[0] as string).trim().split(/\s+/)[0]!.toUpperCase(),
    )
    expect(calls).toContain('ROLLBACK')
    expect(calls).not.toContain('COMMIT')
  })
})
