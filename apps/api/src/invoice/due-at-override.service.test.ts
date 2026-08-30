/**
 * Unit tests for DueAtOverrideService (T-04.1.03.03).
 *
 * Mocks `getDbPool` and verifies: load, successful override (due_at +
 * metadata + audit in one transaction), required reason, overridable
 * states, issuedAt bound, unchanged rejection, missing invoice, rollback.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { HttpException } from '@nestjs/common'
import { ErrorCodes } from '@barghsa/shared/errors'
import { DUE_AT_OVERRIDE_ERRORS, DUE_AT_OVERRIDE_EVENT } from '@barghsa/shared/finance'
import { DueAtOverrideService } from './due-at-override.service.js'
import { InvoiceAuditRepository } from './invoice-audit.repository.js'

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
  v7: vi.fn(() => 'audit-due-at-override-0001'),
}))

const INVOICE_ID = '11111111-1111-7111-8111-111111111111'
const ISSUED = new Date('2026-08-01T10:00:00.000Z')
const CURRENT_DUE = new Date('2026-08-08T10:00:00.000Z')
const NEW_DUE = new Date('2026-09-15T08:00:00.000Z')
const NOW = new Date('2026-08-02T12:00:00.000Z')

function invoiceRow(overrides: Record<string, unknown> = {}) {
  return {
    id: INVOICE_ID,
    state: 'Unpaid',
    issued_at: ISSUED,
    payable_from: ISSUED,
    due_at: CURRENT_DUE,
    metadata: {
      due: { source: 'config', dueAt: CURRENT_DUE.toISOString(), configDays: 7 },
    },
    ...overrides,
  }
}

function mockQuery(handler: (sql: string, params?: unknown[]) => unknown) {
  mockClient.query.mockImplementation(async (sql: string, params?: unknown[]) =>
    handler(sql, params),
  )
}

function body() {
  return { dueAt: NEW_DUE.toISOString(), reason: 'Customer requested an extension' }
}

function overrideInput(raw: unknown = body()) {
  return {
    invoiceId: INVOICE_ID,
    raw,
    actorUserId: 'staff-001',
    ip: '10.0.0.9',
    correlationId: 'corr-override',
    now: NOW,
  }
}

function rejectionBody(error: unknown): Record<string, unknown> {
  if (error instanceof HttpException) {
    return error.getResponse() as Record<string, unknown>
  }
  throw new Error(`expected HttpException, got ${String(error)}`)
}

describe('DueAtOverrideService (T-04.1.03.03)', () => {
  let service: DueAtOverrideService

  beforeEach(() => {
    vi.clearAllMocks()
    service = new DueAtOverrideService(new InvoiceAuditRepository())
    mockPool.connect.mockResolvedValue(mockClient)
    mockClient.release.mockImplementation(() => {})
  })

  describe('get', () => {
    it('returns the current dueAt snapshot and canOverride', async () => {
      mockPool.query.mockResolvedValueOnce({ rows: [invoiceRow()] })
      const dto = await service.get(INVOICE_ID)
      expect(dto.invoiceId).toBe(INVOICE_ID)
      expect(dto.state).toBe('Unpaid')
      expect(dto.dueAt).toBe(CURRENT_DUE.toISOString())
      expect(dto.canOverride).toBe(true)
      expect(dto.dueAtOverride).toBeNull()
    })

    it('404s when the invoice is missing', async () => {
      mockPool.query.mockResolvedValueOnce({ rows: [] })
      const rejection = await service.get(INVOICE_ID).catch((e: unknown) => e)
      expect(rejection).toMatchObject({ status: 404 })
      expect(rejectionBody(rejection)).toMatchObject({
        error: ErrorCodes.NOT_FOUND_RESOURCE.code,
      })
    })
  })

  describe('override', () => {
    it('updates due_at, stores reason in metadata, and writes the audit event', async () => {
      const calls: Array<{ sql: string; params?: unknown[] }> = []
      mockQuery((sql, params) => {
        calls.push({ sql, ...(params !== undefined ? { params } : {}) })
        if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK') return { rows: [] }
        if (sql.includes('FOR UPDATE')) return { rows: [invoiceRow()] }
        if (sql.startsWith('UPDATE invoices')) return { rows: [] }
        if (sql.includes('INSERT INTO audit_log')) return { rows: [] }
        return { rows: [] }
      })

      const dto = await service.override(overrideInput())
      expect(dto.dueAt).toBe(NEW_DUE.toISOString())
      expect(dto.dueAtOverride?.reason).toBe('Customer requested an extension')
      expect(dto.dueAtOverride?.customerVisible).toBe(true)
      expect(dto.dueAtOverride?.previousDueAt).toBe(CURRENT_DUE.toISOString())
      expect(dto.auditId).toBe('audit-due-at-override-0001')

      const update = calls.find((c) => c.sql.startsWith('UPDATE invoices'))
      expect(update).toBeDefined()
      expect((update!.params![0] as Date).getTime()).toBe(NEW_DUE.getTime())
      const meta = JSON.parse(update!.params![1] as string) as Record<string, unknown>
      expect(meta.dueAtOverride).toMatchObject({
        reason: 'Customer requested an extension',
        customerVisible: true,
        dueAt: NEW_DUE.toISOString(),
      })
      expect((meta.due as Record<string, unknown>).source).toBe('staff_override')
      expect(Array.isArray(meta.dueAtOverrides)).toBe(true)

      const audit = calls.find((c) => c.sql.includes('INSERT INTO audit_log'))
      expect(audit).toBeDefined()
      expect(audit!.params![2]).toBe(DUE_AT_OVERRIDE_EVENT)
      expect(audit!.params![3]).toContain('"reason":"Customer requested an extension"')
      expect(audit!.params![3]).toContain('"customerVisible":true')
      expect(calls.some((c) => c.sql === 'COMMIT')).toBe(true)
      expect(mockClient.release).toHaveBeenCalledTimes(1)
    })

    it('rejects a missing reason', async () => {
      const rejection = await service
        .override(overrideInput({ dueAt: NEW_DUE.toISOString(), reason: '  ' }))
        .catch((e: unknown) => e)
      expect(rejection).toMatchObject({ status: 400 })
      expect(rejectionBody(rejection)).toMatchObject({
        error: ErrorCodes.VALIDATION_INPUT_INVALID.code,
      })
      expect(String(rejectionBody(rejection).message)).toContain(
        DUE_AT_OVERRIDE_ERRORS.BAD_REASON(),
      )
      expect(mockPool.connect).not.toHaveBeenCalled()
    })

    it('rejects a Paid invoice (not overridable)', async () => {
      mockQuery((sql) => {
        if (sql === 'BEGIN' || sql === 'ROLLBACK') return { rows: [] }
        if (sql.includes('FOR UPDATE')) return { rows: [invoiceRow({ state: 'Paid' })] }
        return { rows: [] }
      })
      const rejection = await service.override(overrideInput()).catch((e: unknown) => e)
      expect(rejection).toMatchObject({ status: 409 })
      expect(rejectionBody(rejection)).toMatchObject({
        error: ErrorCodes.CONFLICT_STATE.code,
      })
      expect(String(rejectionBody(rejection).message)).toContain('Paid')
    })

    it('rejects a dueAt before issuedAt', async () => {
      mockQuery((sql) => {
        if (sql === 'BEGIN' || sql === 'ROLLBACK') return { rows: [] }
        if (sql.includes('FOR UPDATE')) return { rows: [invoiceRow()] }
        return { rows: [] }
      })
      const rejection = await service
        .override(
          overrideInput({
            dueAt: '2026-07-01T00:00:00.000Z',
            reason: 'Backdate',
          }),
        )
        .catch((e: unknown) => e)
      expect(rejection).toMatchObject({ status: 400 })
      expect(String(rejectionBody(rejection).message)).toBe(
        DUE_AT_OVERRIDE_ERRORS.BEFORE_ISSUED_AT(),
      )
    })

    it('rejects an unchanged dueAt', async () => {
      mockQuery((sql) => {
        if (sql === 'BEGIN' || sql === 'ROLLBACK') return { rows: [] }
        if (sql.includes('FOR UPDATE')) return { rows: [invoiceRow()] }
        return { rows: [] }
      })
      const rejection = await service
        .override(
          overrideInput({
            dueAt: CURRENT_DUE.toISOString(),
            reason: 'Same date',
          }),
        )
        .catch((e: unknown) => e)
      expect(rejection).toMatchObject({ status: 400 })
      expect(String(rejectionBody(rejection).message)).toBe(DUE_AT_OVERRIDE_ERRORS.UNCHANGED())
    })

    it('404s when the locked row is missing', async () => {
      mockQuery((sql) => {
        if (sql === 'BEGIN' || sql === 'ROLLBACK') return { rows: [] }
        if (sql.includes('FOR UPDATE')) return { rows: [] }
        return { rows: [] }
      })
      const rejection = await service.override(overrideInput()).catch((e: unknown) => e)
      expect(rejection).toMatchObject({ status: 404 })
      expect(rejectionBody(rejection)).toMatchObject({
        error: ErrorCodes.NOT_FOUND_RESOURCE.code,
      })
    })

    it('rolls back when the audit insert fails', async () => {
      mockQuery((sql) => {
        if (sql === 'BEGIN' || sql === 'ROLLBACK') return { rows: [] }
        if (sql.includes('FOR UPDATE')) return { rows: [invoiceRow()] }
        if (sql.startsWith('UPDATE invoices')) return { rows: [] }
        if (sql.includes('INSERT INTO audit_log')) throw new Error('audit fk')
        return { rows: [] }
      })
      await expect(service.override(overrideInput())).rejects.toThrow('audit fk')
      const sqls = mockClient.query.mock.calls.map((c: unknown[]) => c[0] as string)
      expect(sqls).toContain('ROLLBACK')
      expect(sqls).not.toContain('COMMIT')
      expect(mockClient.release).toHaveBeenCalledTimes(1)
    })
  })
})
