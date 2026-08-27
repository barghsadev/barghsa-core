import { describe, it, expect, beforeEach, vi } from 'vitest'
import { HttpException } from '@nestjs/common'
import type { AdminService as AdminServiceType } from './admin.service.js'
import { DEFAULT_DUAL_APPROVAL_CONFIG } from '@barghsa/shared/finance'
import { DUAL_APPROVAL_THRESHOLD_CONFIG_KEY } from '@barghsa/shared/finance'

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

// ─── Tests — getDualApprovalThresholdConfig ──────────────────────────

describe('AdminService.getDualApprovalThresholdConfig (T-09.07.01)', () => {
  it('returns the disabled default when no value is persisted', async () => {
    const { mockQuery } = await loadService()
    mockQuery.mockResolvedValueOnce({ rows: [] })

    const result = await service.getDualApprovalThresholdConfig()
    expect(result).toEqual(DEFAULT_DUAL_APPROVAL_CONFIG)
    expect(mockQuery).toHaveBeenCalledWith(
      expect.stringContaining('app_config'),
      [DUAL_APPROVAL_THRESHOLD_CONFIG_KEY],
    )
  })

  it('maps a stored snake_case value to the camelCase config shape', async () => {
    const { mockQuery } = await loadService()
    mockQuery.mockResolvedValueOnce({
      rows: [{ value: { threshold_irr: 750_000_000 } }],
    })

    const result = await service.getDualApprovalThresholdConfig()
    expect(result).toEqual({ thresholdIrR: 750_000_000 })
  })
})

// ─── Tests — setDualApprovalThresholdConfig ──────────────────────────

describe('AdminService.setDualApprovalThresholdConfig (T-09.07.01)', () => {
  it('rejects a negative threshold with a 400', async () => {
    const { pool } = await loadService()
    await expect(
      service.setDualApprovalThresholdConfig(
        { threshold_irr: -1 },
        'admin-1',
        '127.0.0.1',
      ),
    ).rejects.toMatchObject({ status: 400 })
    expect(pool.connect).not.toHaveBeenCalled()
  })

  it('rejects a fractional threshold with a 400', async () => {
    await loadService()
    await expect(
      service.setDualApprovalThresholdConfig(
        { threshold_irr: 1.5 },
        'admin-1',
        '127.0.0.1',
      ),
    ).rejects.toThrowError(HttpException)
  })

  it('rejects a missing threshold with a 400', async () => {
    await loadService()
    await expect(
      service.setDualApprovalThresholdConfig({}, 'admin-1', '127.0.0.1'),
    ).rejects.toMatchObject({ status: 400 })
  })

  it('persists a valid threshold, bumps config version, and records an audit', async () => {
    const { pool, mockConnect } = await loadService()
    const { client } = mockClient()
    mockConnect.mockResolvedValue(client)

    await service.setDualApprovalThresholdConfig(
      { threshold_irr: 500_000_000 },
      'admin-1',
      '127.0.0.1',
    )

    // BEGIN, INSERT app_config, UPDATE config_version, INSERT audit_log, COMMIT
    expect(mockConnect).toHaveBeenCalledTimes(1)
    const queries = client.query.mock.calls.map((c: unknown[]) => String(c[0]))
    expect(queries[0]!).toMatch(/BEGIN/)
    expect(queries[1]!).toMatch(/INSERT INTO app_config/)
    expect(queries[2]!).toMatch(/config_version/)
    expect(queries[3]!).toMatch(/audit_log/)
    expect(queries[4]!).toMatch(/COMMIT/)

    // The stored value is snake_case and carries the correct key
    const appConfigQuery = client.query.mock.calls[1]!
    expect((appConfigQuery[1] as unknown[])[0]).toBe(DUAL_APPROVAL_THRESHOLD_CONFIG_KEY)
    const stored = JSON.parse((appConfigQuery[1] as unknown[])[1] as string)
    expect(stored).toEqual({ threshold_irr: 500_000_000 })

    // The audit metadata records the same key and new value
    const auditQuery = client.query.mock.calls[3]!
    const auditMetadata = JSON.parse((auditQuery[1] as unknown[])[3] as string)
    expect(auditMetadata).toEqual({
      key: DUAL_APPROVAL_THRESHOLD_CONFIG_KEY,
      newValue: { threshold_irr: 500_000_000 },
    })

    expect(client.release).toHaveBeenCalledTimes(1)
    expect(pool.query).not.toHaveBeenCalled() // get path does not run on set
  })

  it('returns the persisted camelCase config', async () => {
    const { mockConnect } = await loadService()
    const { client } = mockClient()
    mockConnect.mockResolvedValue(client)

    const result = await service.setDualApprovalThresholdConfig(
      { threshold_irr: 0 },
      'admin-1',
      '127.0.0.1',
    )
    expect(result).toEqual({ thresholdIrR: 0 })
  })
})