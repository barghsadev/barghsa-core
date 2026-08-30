/**
 * Unit tests for ManualInvoiceService (T-04.1.02.02).
 *
 * Mocks `getDbPool` from @barghsa/db and verifies the create-and-issue
 * flow: validation → profile check → invoice insert → line inserts →
 * state-machine Issue on the SAME client (no nested BEGIN/COMMIT) →
 * COMMIT. Also covers validation errors, missing profile, idempotency
 * replay, and rollback on failure.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { BadRequestException, NotFoundException } from '@nestjs/common'
import { ManualInvoiceService, fingerprintManualInvoice } from './manual-invoice.service.js'
import { InvoiceStateMachineService } from './invoice-state-machine.service.js'
import { InvoiceAuditRepository } from './invoice-audit.repository.js'
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

// ---- Helpers ----
function mockQuery(handler: (sql: string, params?: unknown[]) => unknown) {
  mockClient.query.mockImplementation(async (sql: string, params?: unknown[]) => handler(sql, params))
}

function command(overrides: Record<string, unknown> = {}) {
  return {
    profileId: 'profile-001',
    actorUserId: 'staff-001',
    lines: [
      { description: 'برق مصرفی', quantity: 1, unitPrice: 1_000_000n, vatRate: 900 },
    ],
    now: new Date('2026-08-01T10:00:00.000Z'),
    ...overrides,
  }
}

/** The fingerprint the service itself computes for the base command. */
function fingerprintForTest() {
  return fingerprintManualInvoice(command({ idempotencyKey: 'manual-inv-123' }))
}

describe('ManualInvoiceService', () => {
  let service: ManualInvoiceService

  beforeEach(() => {
    vi.clearAllMocks()
    const stateMachine = new InvoiceStateMachineService(new InvoiceAuditRepository())
    service = new ManualInvoiceService(
      stateMachine,
      new DueAtCalculationService(new DueAtCalculationRepository()),
    )
    mockPool.connect.mockResolvedValue(mockClient)
    mockClient.release.mockImplementation(() => {})
  })

  describe('createManualInvoice', () => {
    it('creates and issues the invoice atomically on one client', async () => {
      const calls: string[] = []
      mockQuery((sql) => {
        calls.push(sql.trim().split(/\s+/)[0]!.toUpperCase())
        if (sql.startsWith('SELECT id FROM profiles')) return { rows: [{ id: 'profile-001' }] }
        if (sql.startsWith("SELECT id, metadata FROM invoices")) return { rows: [] }
        if (sql.startsWith('INSERT INTO invoices')) return { rows: [] }
        if (sql.startsWith('INSERT INTO invoice_lines')) return { rows: [] }
        if (sql.startsWith('SELECT id, state FROM invoices')) return { rows: [{ id: 'inv', state: 'Draft' }] }
        if (sql.startsWith('UPDATE invoices')) return { rows: [] }
        if (sql.startsWith('INSERT INTO audit_log')) return { rows: [] }
        if (sql.startsWith('SELECT id, profile_id')) return {
          rows: [{
            id: '00000000-0000-7000-8000-000000000001',
            profile_id: 'profile-001',
            contract_id: null,
            state: 'Unpaid',
            total_amount: '1090000',
            issued_at: new Date('2026-08-01T10:00:00.000Z'),
            payable_from: new Date('2026-08-01T10:00:00.000Z'),
            due_at: new Date('2026-08-08T10:00:00.000Z'),
          }],
        }
        if (sql.startsWith('SELECT id, description')) return {
          rows: [{
            id: '00000000-0000-7000-8000-000000000002',
            description: 'برق مصرفی',
            quantity: 1,
            unit_price: '1000000',
            line_total: '1000000',
            vat_rate: 900,
            vat_amount: '90000',
            is_taxable: true,
            position: 0,
          }],
        }
        return { rows: [] }
      })

      const result = await service.createManualInvoice(command())

      expect(result.invoiceId).toBe('00000000-0000-7000-8000-000000000001')
      expect(result.state).toBe('Unpaid')
      expect(result.totalAmount).toBe(1_090_000n)
      expect(result.lines[0]!.vatAmount).toBe(90_000n)
      expect(result.transition.transition).toBe('Issue')

      // Atomicity: exactly one BEGIN and one COMMIT, both on the same client
      expect(calls.filter((c) => c === 'BEGIN')).toHaveLength(1)
      expect(calls.filter((c) => c === 'COMMIT')).toHaveLength(1)
      // The state machine must NOT open its own transaction
      expect(mockPool.connect).toHaveBeenCalledTimes(1)
      expect(mockClient.release).toHaveBeenCalledTimes(1)
      // The read-back happens BEFORE COMMIT (read-your-own-writes inside
      // the tx) so a read failure cannot report a committed invoice as
      // failed.
      const readIdx = mockClient.query.mock.calls.findIndex(
        (c) => (c[0] as string).startsWith('SELECT id, profile_id'),
      )
      const commitIdx = mockClient.query.mock.calls.findIndex(
        (c) => (c[0] as string) === 'COMMIT',
      )
      expect(readIdx).toBeGreaterThanOrEqual(0)
      expect(commitIdx).toBeGreaterThan(readIdx)

      const insertCall = mockClient.query.mock.calls.find(
        (c) => (c[0] as string).startsWith('INSERT INTO invoices'),
      )
      expect(insertCall).toBeDefined()
      expect(insertCall![0] as string).toContain('invoice_calculation_snapshot')
      const snapshot = JSON.parse(insertCall![1]![6] as string) as {
        version: number
        source: string
        steps: Array<{ vat: { result: string } }>
        totals: { totalAmount: string }
      }
      expect(snapshot.version).toBe(1)
      expect(snapshot.source).toBe('manual')
      expect(snapshot.steps[0]!.vat.result).toBe('90000')
      expect(snapshot.totals.totalAmount).toBe('1090000')
    })

    it('rejects invalid lines with BadRequestException', async () => {
      await expect(
        service.createManualInvoice(
          command({ lines: [{ description: 'x', quantity: 0, unitPrice: 100n, vatRate: 0 }] }),
        ),
      ).rejects.toThrow(BadRequestException)
      // No DB interaction for pure validation failures
      expect(mockPool.connect).not.toHaveBeenCalled()
    })

    it('rejects an empty line list lifecycle', async () => {
      await expect(
        service.createManualInvoice(command({ lines: [] })),
      ).rejects.toThrow(BadRequestException)
    })

    it('throws NotFoundException for a missing profile and rolls back', async () => {
      mockQuery((sql) => {
        if (sql.startsWith('SELECT id FROM profiles')) return { rows: [] }
        return { rows: [] }
      })

      await expect(
        service.createManualInvoice(command()),
      ).rejects.toThrow(NotFoundException)

      const calls = mockClient.query.mock.calls.map((c) => (c[0] as string).trim().split(/\s+/)[0]!.toUpperCase())
      expect(calls).toContain('ROLLBACK')
      expect(calls).not.toContain('COMMIT')
    })

    it('replays the existing invoice when the idempotency key is reused', async () => {
      mockQuery((sql) => {
        if (sql.startsWith('SELECT id FROM profiles')) return { rows: [{ id: 'profile-001' }] }
        if (sql.startsWith('SELECT id, metadata FROM invoices')) return {
          rows: [{ id: '00000000-0000-7000-8000-000000000007', metadata: { fingerprint: fingerprintForTest() } }],
        }
        if (sql.startsWith('SELECT id FROM audit_log')) return {
          rows: [{ id: '00000000-0000-7000-8000-000000000009' }],
        }
        if (sql.startsWith('SELECT id, profile_id')) return {
          rows: [{
            id: '00000000-0000-7000-8000-000000000007',
            profile_id: 'profile-001',
            contract_id: null,
            state: 'Unpaid',
            total_amount: '1090000',
            issued_at: new Date('2026-08-01T10:00:00.000Z'),
            payable_from: new Date('2026-08-01T10:00:00.000Z'),
            due_at: new Date('2026-08-08T10:00:00.000Z'),
          }],
        }
        if (sql.startsWith('SELECT id, description')) return { rows: [] }
        return { rows: [] }
      })

      const result = await service.createManualInvoice(
        command({ idempotencyKey: 'manual-inv-123' }),
      )

      expect(result.invoiceId).toBe('00000000-0000-7000-8000-000000000007')
      expect(result.auditId).toBe('00000000-0000-7000-8000-000000000009')
      // No invoice INSERT should have happened
      const inserts = mockClient.query.mock.calls.filter(
        (c) => (c[0] as string).startsWith('INSERT INTO invoices'),
      )
      expect(inserts).toHaveLength(0)
      // The state machine was not invoked for the replay
      const lockCalls = mockClient.query.mock.calls.filter(
        (c) => (c[0] as string).includes('FOR UPDATE'),
      )
      expect(lockCalls).toHaveLength(0)
    })

    it('rejects an idempotency key reused with a different payload', async () => {
      mockQuery((sql) => {
        if (sql.startsWith('SELECT id FROM profiles')) return { rows: [{ id: 'profile-001' }] }
        if (sql.startsWith('SELECT id, metadata FROM invoices')) return {
          rows: [{ id: '00000000-0000-7000-8000-000000000007', metadata: { fingerprint: 'different-fingerprint' } }],
        }
        return { rows: [] }
      })

      await expect(
        service.createManualInvoice(
          command({ idempotencyKey: 'manual-inv-123' }),
        ),
      ).rejects.toThrow('already used with a different payload')
      // No COMMIT — the conflict aborts the transaction
      const calls = mockClient.query.mock.calls.map((c) => (c[0] as string).trim().split(/\s+/)[0]!.toUpperCase())
      expect(calls).not.toContain('COMMIT')
    })

    it('rolls back when the Issue transition fails', async () => {
      mockQuery((sql) => {
        if (sql.startsWith('SELECT id FROM profiles')) return { rows: [{ id: 'profile-001' }] }
        if (sql.startsWith('SELECT id, metadata FROM invoices')) return { rows: [] }
        if (sql.startsWith('INSERT INTO invoices')) return { rows: [] }
        if (sql.startsWith('INSERT INTO invoice_lines')) return { rows: [] }
        if (sql.startsWith('SELECT id, state FROM invoices')) return { rows: [{ id: 'inv', state: 'Draft' }] }
        if (sql.startsWith('UPDATE invoices')) throw new Error('DB down')
        return { rows: [] }
      })

      await expect(
        service.createManualInvoice(command()),
      ).rejects.toThrow('DB down')

      const calls = mockClient.query.mock.calls.map((c) => (c[0] as string).trim().split(/\s+/)[0]!.toUpperCase())
      expect(calls).toContain('ROLLBACK')
      expect(calls).not.toContain('COMMIT')
    })
  })
})