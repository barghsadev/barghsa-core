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

  it('serves normalized values and warns on a corrupt persisted value', async () => {
    const { mockQuery } = await loadService()
    mockQuery.mockResolvedValueOnce({
      rows: [{ value: { ticket: 'soon', verification_case: 0 } }],
    })

    const warnSpy = vi.spyOn(service['logger'], 'warn').mockImplementation(() => undefined)
    const result = await service.getServiceResponseTargets()
    expect(result).toEqual({ ticket: null, verification_case: null })
    expect(warnSpy).toHaveBeenCalledTimes(1)
  })

  it('keeps valid types and disables only the corrupt types in a mixed stored value', async () => {
    const { mockQuery } = await loadService()
    // One valid, one corrupt: the valid target must survive normalization
    // while only the corrupt type degrades to disabled.
    mockQuery.mockResolvedValueOnce({
      rows: [{ value: { ticket: 48, verification_case: 0 } }],
    })

    const warnSpy = vi.spyOn(service['logger'], 'warn').mockImplementation(() => undefined)
    const result = await service.getServiceResponseTargets()
    expect(result).toEqual({ ticket: 48, verification_case: null })
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

  // Transaction, versioning and rollback coverage uses the real HTTP/database fixture.
})
