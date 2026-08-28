import { describe, it, expect, beforeEach, vi } from 'vitest'
import { HttpException } from '@nestjs/common'
import type { ReconciliationExceptionsService as ServiceType } from './reconciliation-exceptions.service.js'
import { toReconciliationExceptionDto, validateResolutionNote } from './reconciliation-exceptions.service.js'

// ─── Helpers ──────────────────────────────────────────────────────────

function mockPool() {
  const mockQuery = vi.fn()
  const mockConnect = vi.fn()
  return { mockQuery, mockConnect, pool: { query: mockQuery, connect: mockConnect } }
}

function mockClient() {
  const mockClientQuery = vi.fn()
  const mockRelease = vi.fn()
  return { mockClientQuery, mockRelease, client: { query: mockClientQuery, release: mockRelease } }
}

function mockDbModule(pool: { query: ReturnType<typeof vi.fn>; connect: ReturnType<typeof vi.fn> }) {
  return { getDbPool: () => pool }
}

beforeEach(() => {
  vi.resetModules()
  vi.restoreAllMocks()
})

/** Load the service with a mocked @barghsa/db pool. */
async function loadService() {
  const { pool, mockQuery, mockConnect } = mockPool()
  vi.doMock('@barghsa/db', () => mockDbModule(pool))
  const { ReconciliationExceptionsService: Svc } = await import('./reconciliation-exceptions.service.js')
  const service: ServiceType = new Svc()
  return { service, pool, mockQuery, mockConnect }
}

function httpStatus(error: unknown): number | undefined {
  if (error instanceof HttpException) return error.getStatus()
  return undefined
}

const OPEN_ROW = {
  id: 'ex-1',
  exception_type: 'wallet_mismatch',
  severity: 'high',
  status: 'open',
  description: 'Ledger sum does not match wallet balance',
  details: { ledger: 1000, wallet: 900 },
  assigned_to_id: null,
  assigned_to_username: null,
  resolved_by_id: null,
  resolved_by_username: null,
  resolution_note: null,
  resolved_at: null,
  created_at: new Date('2026-08-28T00:00:00Z'),
  updated_at: new Date('2026-08-28T00:00:00Z'),
}

function returnRow(row: Record<string, unknown>) {
  return { rows: [row] }
}

// ─── listReconciliationExceptions ─────────────────────────────────────

describe('ReconciliationExceptionsService.listReconciliationExceptions (T-09.09.01)', () => {
  it('lists exceptions, maps rows to DTOs, and orders newest first', async () => {
    const { service, mockQuery } = await loadService()
    const listRow = {
      ...OPEN_ROW,
      status: 'open',
      assigned_to_username: 'staff1',
    }
    mockQuery.mockResolvedValueOnce({ rows: [listRow] })
    const result = await service.listReconciliationExceptions()
    expect(result[0]).toMatchObject({
      id: 'ex-1',
      exceptionType: 'wallet_mismatch',
      severity: 'high',
      status: 'open',
      assignedToId: null,
      assignedToUsername: 'staff1',
      resolvedById: null,
    })
    expect(String(mockQuery.mock.calls[0]![0])).toContain(
      'ORDER BY rex.created_at DESC, rex.id DESC',
    )
  })

  it('passes status/severity filters through to the query', async () => {
    const { service, mockQuery } = await loadService()
    mockQuery.mockResolvedValueOnce({ rows: [] })
    await service.listReconciliationExceptions({ status: 'open', severity: 'high' })
    const params = mockQuery.mock.calls[0]![1] as unknown[]
    expect(params[0]).toBe('open')
    expect(params[1]).toBe('high')
  })

  it('rejects an invalid status filter with 400 without querying', async () => {
    const { service, mockQuery } = await loadService()
    const rejection = await service
      .listReconciliationExceptions({ status: 'bogus' as never })
      .catch((e: unknown) => e)
    expect(httpStatus(rejection)).toBe(400)
    expect(mockQuery).not.toHaveBeenCalled()
  })

  it('rejects an invalid severity filter with 400 without querying', async () => {
    const { service, mockQuery } = await loadService()
    const rejection = await service
      .listReconciliationExceptions({ severity: 'bogus' as never })
      .catch((e: unknown) => e)
    expect(httpStatus(rejection)).toBe(400)
    expect(mockQuery).not.toHaveBeenCalled()
  })
})

// ─── investigate ──────────────────────────────────────────────────────

describe('ReconciliationExceptionsService.investigate (T-09.09.01)', () => {
  it('transitions open → investigating and records reconciliation_status_changed', async () => {
    const { service, mockConnect, mockQuery } = await loadService()
    const { mockClientQuery, client } = mockClient()
    mockConnect.mockResolvedValue(client)
    mockClientQuery
      .mockResolvedValueOnce({ rows: [] }) // BEGIN
      .mockResolvedValueOnce(returnRow(OPEN_ROW)) // locked SELECT
      .mockResolvedValueOnce({ rows: [] }) // UPDATE
      .mockResolvedValueOnce({ rows: [] }) // audit INSERT
      .mockResolvedValueOnce({ rows: [] }) // COMMIT
    mockQuery.mockResolvedValueOnce(returnRow({ ...OPEN_ROW, status: 'investigating' })) // DTO read

    const dto = await service.investigateReconciliationException('ex-1', 'admin-1', '1.1.1.1')

    expect(dto).toMatchObject({ id: 'ex-1', status: 'investigating' })

    const updateCall = mockClientQuery.mock.calls[2]!
    expect(String(updateCall[0])).toContain('UPDATE reconciliation_exceptions')
    expect(updateCall[1]![0]).toBe('investigating')

    const auditCall = mockClientQuery.mock.calls[3]!
    expect(String(auditCall[0])).toContain('INSERT INTO audit_log')
    expect(auditCall[1]![2]).toBe('reconciliation_status_changed')
  })

  it('rejects investigate on a non-open state with 409', async () => {
    const { service, mockConnect } = await loadService()
    const { mockClientQuery, client } = mockClient()
    mockConnect.mockResolvedValue(client)
    mockClientQuery
      .mockResolvedValueOnce({ rows: [] }) // BEGIN
      .mockResolvedValueOnce(returnRow({ ...OPEN_ROW, status: 'resolved' })) // locked SELECT
    const rejection = await service
      .investigateReconciliationException('ex-1', 'admin', '1.1.1.1')
      .catch((e: unknown) => e)
    expect(httpStatus(rejection)).toBe(409)
    // No UPDATE reached the DB for an illegal transition.
    expect(mockClientQuery.mock.calls.map((c) => String(c[0]))).not.toContain(
      expect.stringContaining('UPDATE reconciliation_exceptions'),
    )
  })
})

// ─── resolve ──────────────────────────────────────────────────────────

describe('ReconciliationExceptionsService.resolve (T-09.09.01)', () => {
  it('rejects a missing note with 400 before touching the DB', async () => {
    const { service, mockQuery } = await loadService()
    const rejection = await service
      .resolveReconciliationException('ex-1', 'admin-1', '1.1.1.1', undefined)
      .catch((e: unknown) => e)
    expect(httpStatus(rejection)).toBe(400)
    expect(mockQuery).not.toHaveBeenCalled()
  })

  it('transitions open → resolved and records resolution_recorded', async () => {
    const { service, mockConnect, mockQuery } = await loadService()
    const { mockClientQuery, client } = mockClient()
    mockConnect.mockResolvedValue(client)
    mockClientQuery
      .mockResolvedValueOnce({ rows: [] }) // BEGIN
      .mockResolvedValueOnce(returnRow(OPEN_ROW)) // locked SELECT
      .mockResolvedValueOnce({ rows: [] }) // UPDATE
      .mockResolvedValueOnce({ rows: [] }) // audit INSERT
      .mockResolvedValueOnce({ rows: [] }) // COMMIT
    mockQuery.mockResolvedValueOnce(returnRow({ ...OPEN_ROW, status: 'resolved' })) // DTO read

    const dto = await service.resolveReconciliationException('ex-1', 'admin-1', '1.1.1.1', 'balanced')

    expect(dto).toMatchObject({ id: 'ex-1', status: 'resolved', resolutionNote: null })
    expect(mockClientQuery.mock.calls[2]![1]![0]).toBe('resolved')
    expect(mockClientQuery.mock.calls[3]![1]![2]).toBe('resolution_recorded')
    expect(mockClientQuery.mock.calls[3]![1]![3]).toContain('reconciliationExceptionId')
  })

  it('rejects a transition from a terminal state with 409', async () => {
    const { service, mockConnect } = await loadService()
    const { mockClientQuery, client } = mockClient()
    mockConnect.mockResolvedValue(client)
    mockClientQuery
      .mockResolvedValueOnce({ rows: [] }) // BEGIN
      .mockResolvedValueOnce(returnRow({ ...OPEN_ROW, status: 'closed' })) // locked SELECT
    const rejection = await service
      .resolveReconciliationException('ex-1', 'admin', '1.1.1.1', 'nope')
      .catch((e: unknown) => e)
    expect(httpStatus(rejection)).toBe(409)
    expect(mockClientQuery.mock.calls.map((c) => String(c[0]))).not.toContain(
      expect.stringContaining('UPDATE reconciliation_exceptions'),
    )
  })

  it('returns 404 for a missing exception', async () => {
    const { service, mockConnect } = await loadService()
    const { mockClientQuery, client } = mockClient()
    mockConnect.mockResolvedValue(client)
    mockClientQuery
      .mockResolvedValueOnce({ rows: [] }) // BEGIN
      .mockResolvedValueOnce({ rows: [] }) // locked SELECT empty
    const rejection = await service
      .resolveReconciliationException('missing', 'admin', '1.1.1.1', 'x')
      .catch((e: unknown) => e)
    expect(httpStatus(rejection)).toBe(404)
  })
})

// ─── close ────────────────────────────────────────────────────────────

describe('ReconciliationExceptionsService.close (T-09.09.01)', () => {
  it('transitions a resolved item to closed and records resolution_recorded', async () => {
    const { service, mockConnect, mockQuery } = await loadService()
    const { mockClientQuery, client } = mockClient()
    mockConnect.mockResolvedValue(client)
    const resolvedRow = { ...OPEN_ROW, status: 'resolved' }
    mockClientQuery
      .mockResolvedValueOnce({ rows: [] }) // BEGIN
      .mockResolvedValueOnce(returnRow(resolvedRow)) // locked SELECT
      .mockResolvedValueOnce({ rows: [] }) // UPDATE
      .mockResolvedValueOnce({ rows: [] }) // audit INSERT
      .mockResolvedValueOnce({ rows: [] }) // COMMIT
    mockQuery.mockResolvedValueOnce(returnRow({ ...OPEN_ROW, status: 'closed' })) // DTO read

    const dto = await service.closeReconciliationException('ex-1', 'admin', '1.1.1.1', 'dismissed')

    expect(dto).toMatchObject({ id: 'ex-1', status: 'closed' })
    expect(mockClientQuery.mock.calls[2]![1]![0]).toBe('closed')
    expect(mockClientQuery.mock.calls[3]![1]![2]).toBe('resolution_recorded')
  })

  it('rejects close when already closed', async () => {
    const { service, mockConnect } = await loadService()
    const { mockClientQuery, client } = mockClient()
    mockConnect.mockResolvedValue(client)
    mockClientQuery
      .mockResolvedValueOnce({ rows: [] }) // BEGIN
      .mockResolvedValueOnce(returnRow({ ...OPEN_ROW, status: 'closed' })) // locked SELECT
    const rejection = await service
      .closeReconciliationException('ex-1', 'admin', '1.1.1.1', 'x')
      .catch((e: unknown) => e)
    expect(httpStatus(rejection)).toBe(409)
  })
})

// ─── validateResolutionNote ───────────────────────────────────────────

describe('validateResolutionNote', () => {
  it('accepts a trimmed non-empty bounded note', () => {
    expect(validateResolutionNote('  fixed it  ')).toEqual({ ok: true, note: 'fixed it', issues: [] })
  })
  it('rejects an empty note', () => {
    expect(validateResolutionNote('   ').ok).toBe(false)
  })
  it('rejects a note longer than 1000 chars', () => {
    expect(validateResolutionNote('x'.repeat(1001)).ok).toBe(false)
  })
})

// ─── toReconciliationExceptionDto ─────────────────────────────────────

describe('toReconciliationExceptionDto', () => {
  it('maps timestamps and joined usernames', () => {
    const dto = toReconciliationExceptionDto({
      ...OPEN_ROW,
      assigned_to_username: 'staff1',
      resolved_by_id: 'u-9',
      resolved_by_username: 'admin9',
      resolution_note: 'done',
      resolved_at: new Date('2026-08-28T01:00:00Z'),
    })
    expect(dto.assignedToUsername).toBe('staff1')
    expect(dto.resolvedByUsername).toBe('admin9')
    expect(dto.resolutionNote).toBe('done')
    expect(dto.resolvedAt).toBe('2026-08-28T01:00:00.000Z')
  })

  it('treats null resolved_at as null', () => {
    const dto = toReconciliationExceptionDto(OPEN_ROW)
    expect(dto.resolvedAt).toBeNull()
    expect(dto.resolvedById).toBeNull()
  })
})