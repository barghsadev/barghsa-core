import { describe, it, expect, beforeEach, vi } from 'vitest'
import { HttpException } from '@nestjs/common'
import type { AdminService as AdminServiceType } from './admin.service.js'
import {
  DEFAULT_SERVICE_RESPONSE_TARGETS,
  SERVICE_RESPONSE_TARGETS_CONFIG_KEY,
} from '@barghsa/shared/admin'

// ─── Helpers ──────────────────────────────────────────────────────────

function mockPool() {
  const mockQuery = vi.fn()
  const mockConnect = vi.fn()
  const pool = { query: mockQuery, connect: mockConnect }
  return { mockQuery, mockConnect, pool }
}

function mockClient() {
  const mockClientQuery = vi.fn()
  const mockRelease = vi.fn()
  const client = { query: mockClientQuery, release: mockRelease }
  return { mockClientQuery, mockRelease, client }
}

const MOCK_ROLES = [
  { id: 'role-admin' as const, name: 'Admin', description: '', permissions: [] },
]

function mockDbModule(pool: { query: ReturnType<typeof vi.fn>; connect: ReturnType<typeof vi.fn> }) {
  return { getDbPool: () => pool, PREDEFINED_ROLES: MOCK_ROLES }
}

let AdminService: typeof AdminServiceType
let service: AdminServiceType

beforeEach(() => {
  vi.resetModules()
  vi.restoreAllMocks()
})

/** Load AdminService with a mocked @barghsa/db pool, and return the pool. */
async function loadService() {
  const { pool, mockQuery, mockConnect } = mockPool()
  vi.doMock('@barghsa/db', () => mockDbModule(pool))
  const { AdminService: Svc } = await import('./admin.service.js')
  service = new Svc()
  return { pool, mockQuery, mockConnect }
}

// ─── Tests — getServiceResponseTargets ────────────────────────────────

describe('AdminService.getServiceResponseTargets (T-09.08.01)', () => {
  it('returns the all-disabled default when no value is persisted', async () => {
    const { mockQuery } = await loadService()
    mockQuery.mockResolvedValueOnce({ rows: [] })

    const result = await service.getServiceResponseTargets()
    expect(result).toEqual(DEFAULT_SERVICE_RESPONSE_TARGETS)
    expect(mockQuery).toHaveBeenCalledWith(
      expect.stringContaining('app_config'),
      [SERVICE_RESPONSE_TARGETS_CONFIG_KEY],
    )
  })

  it('returns the stored map as-is when valid', async () => {
    const { mockQuery } = await loadService()
    mockQuery.mockResolvedValueOnce({
      rows: [{ value: { ticket: 48, verification_case: 72 } }],
    })

    const result = await service.getServiceResponseTargets()
    expect(result).toEqual({ ticket: 48, verification_case: 72 })
  })

  it('fills omitted service types from a stored map with null', async () => {
    const { mockQuery } = await loadService()
    mockQuery.mockResolvedValueOnce({ rows: [{ value: { ticket: 48 } }] })

    const result = await service.getServiceResponseTargets()
    expect(result).toEqual({ ticket: 48, verification_case: null })
  })

  it('serves normalized defaults and warns on a corrupt persisted value', async () => {
    const { mockQuery } = await loadService()
    mockQuery.mockResolvedValueOnce({
      rows: [{ value: { ticket: 'soon', verification_case: 0 } }],
    })

    const warnSpy = vi.spyOn(service['logger'], 'warn').mockImplementation(() => undefined)
    const result = await service.getServiceResponseTargets()
    expect(result).toEqual(DEFAULT_SERVICE_RESPONSE_TARGETS)
    expect(warnSpy).toHaveBeenCalledTimes(1)
  })
})

// ─── Tests — setServiceResponseTargets ────────────────────────────────

describe('AdminService.setServiceResponseTargets (T-09.08.01)', () => {
  it('rejects an unknown service type with a 400', async () => {
    const { pool } = await loadService()
    await expect(
      service.setServiceResponseTargets(
        { ticket: 48, consultation: 24 },
        'admin-1',
        '127.0.0.1',
      ),
    ).rejects.toMatchObject({ status: 400 })
    expect(pool.connect).not.toHaveBeenCalled()
  })

  it('rejects zero, fractional, and out-of-range targets with a 400', async () => {
    await loadService()
    for (const bad of [0, -1, 1.5, 8761, '48']) {
      await expect(
        service.setServiceResponseTargets({ ticket: bad }, 'admin-1', '127.0.0.1'),
      ).rejects.toThrowError(HttpException)
    }
  })

  it('rejects a non-object payload with a 400', async () => {
    await loadService()
    await expect(
      service.setServiceResponseTargets(48 as unknown, 'admin-1', '127.0.0.1'),
    ).rejects.toMatchObject({ status: 400 })
  })

  it('accepts null to disable a service type', async () => {
    const { pool, mockConnect } = await loadService()
    const { client } = mockClient()
    mockConnect.mockResolvedValue(client)
    // BEGIN, SELECT FOR UPDATE (no row), INSERT RETURNING, config_version, audit, COMMIT
    client.query
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ version: 1 }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })

    const result = await service.setServiceResponseTargets(
      { ticket: null },
      'admin-1',
      '127.0.0.1',
    )
    expect(result).toEqual({ ticket: null, verification_case: null })
    expect(pool.connect).toHaveBeenCalledTimes(1)
  })

  it('persists a valid map, bumps config version, and records an audit with the previous value', async () => {
    const { pool, mockConnect } = await loadService()
    const { client } = mockClient()
    mockConnect.mockResolvedValue(client)
    // Call order: BEGIN, SELECT ... FOR UPDATE (existing row),
    // INSERT RETURNING version, config_version, audit_log, COMMIT
    client.query
      .mockResolvedValueOnce({ rows: [] }) // BEGIN
      .mockResolvedValueOnce({
        rows: [{ value: { ticket: 48 }, version: 3 }],
      }) // SELECT ... FOR UPDATE
      .mockResolvedValueOnce({ rows: [{ version: 4 }] }) // INSERT RETURNING
      .mockResolvedValueOnce({ rows: [] }) // config_version
      .mockResolvedValueOnce({ rows: [] }) // audit_log
      .mockResolvedValueOnce({ rows: [] }) // COMMIT

    const result = await service.setServiceResponseTargets(
      { ticket: 24, verification_case: 72 },
      'admin-1',
      '127.0.0.1',
    )
    expect(result).toEqual({ ticket: 24, verification_case: 72 })

    // The audit insert captures the previous value and both versions.
    const auditCall = client.query.mock.calls.find(([sql]) =>
      String(sql).includes('audit_log'),
    )
    expect(auditCall).toBeDefined()
    const auditParams = auditCall![1] as unknown[]
    expect(auditParams[2]).toBe('config_change')
    const metadata = JSON.parse(String(auditParams[3])) as Record<string, unknown>
    expect(metadata).toMatchObject({
      key: SERVICE_RESPONSE_TARGETS_CONFIG_KEY,
      previousValue: { ticket: 48 },
      previousVersion: 3,
      newValue: { ticket: 24, verification_case: 72 },
      version: 4,
    })

    // config_version was bumped for cache invalidation.
    expect(
      client.query.mock.calls.some(([sql]) => String(sql).includes('config_version')),
    ).toBe(true)
  })

  it('persists an empty map as all service types disabled', async () => {
    const { pool, mockConnect } = await loadService()
    const { client } = mockClient()
    mockConnect.mockResolvedValue(client)
    client.query
      .mockResolvedValueOnce({ rows: [] }) // BEGIN
      .mockResolvedValueOnce({ rows: [] }) // SELECT ... FOR UPDATE
      .mockResolvedValueOnce({ rows: [{ version: 1 }] }) // INSERT RETURNING
      .mockResolvedValueOnce({ rows: [] }) // config_version
      .mockResolvedValueOnce({ rows: [] }) // audit_log
      .mockResolvedValueOnce({ rows: [] }) // COMMIT

    const result = await service.setServiceResponseTargets({}, 'admin-1', '127.0.0.1')
    expect(result).toEqual({ ticket: null, verification_case: null })
    // The persisted value is the complete all-disabled map (full replace).
    const auditCall = client.query.mock.calls.find(([sql]) =>
      String(sql).includes('audit_log'),
    )
    const metadata = JSON.parse(String((auditCall![1] as unknown[])[3])) as Record<string, unknown>
    expect(metadata.newValue).toEqual({ ticket: null, verification_case: null })
  })
})
