import { describe, it, expect, beforeEach, vi } from 'vitest'
import { HttpException } from '@nestjs/common'
import type { AdminService as AdminServiceType } from './admin.service.js'
import { DEFAULT_WALLET_TOP_UP_LIMIT_CONFIG } from '@barghsa/shared/finance'
import { WALLET_TOP_UP_LIMIT_CONFIG_KEY } from '@barghsa/shared/finance'

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

// ─── Tests — getWalletTopUpLimitConfig ───────────────────────────────

describe('AdminService.getWalletTopUpLimitConfig (T-09.10.01)', () => {
  it('returns the 2,000,000,000 IRR default when no value is persisted', async () => {
    const { mockQuery } = await loadService()
    mockQuery.mockResolvedValueOnce({ rows: [] })

    const result = await service.getWalletTopUpLimitConfig()
    expect(result).toEqual({ ...DEFAULT_WALLET_TOP_UP_LIMIT_CONFIG, version: 0 })
    expect(mockQuery).toHaveBeenCalledWith(
      expect.stringContaining('app_config'),
      [WALLET_TOP_UP_LIMIT_CONFIG_KEY],
    )
  })

  it('maps a stored snake_case value to the camelCase config shape', async () => {
    const { mockQuery } = await loadService()
    mockQuery.mockResolvedValueOnce({
      rows: [{ value: { limit_irr: 1_500_000_000 }, version: 2 }],
    })

    const result = await service.getWalletTopUpLimitConfig()
    expect(result).toEqual({ limitIrR: 1_500_000_000, version: 2 })
  })

  it('serves the default and warns on a corrupt persisted value', async () => {
    const { mockQuery } = await loadService()
    mockQuery.mockResolvedValueOnce({
      rows: [{ value: { limit_irr: 'corrupted' } }],
    })

    const warnSpy = vi.spyOn(service['logger'], 'warn').mockImplementation(() => undefined)
    const result = await service.getWalletTopUpLimitConfig()
    expect(result).toEqual({ ...DEFAULT_WALLET_TOP_UP_LIMIT_CONFIG, version: 0 })
    expect(warnSpy).toHaveBeenCalledTimes(1)
  })
})

// ─── Tests — setWalletTopUpLimitConfig ───────────────────────────────

describe('AdminService.setWalletTopUpLimitConfig (T-09.10.01)', () => {
  it('rejects a negative limit with a 400', async () => {
    const { pool } = await loadService()
    await expect(
      service.setWalletTopUpLimitConfig(
        { limit_irr: -1 },
        'admin-1',
        '127.0.0.1',
      ),
    ).rejects.toMatchObject({ status: 400 })
    expect(pool.connect).not.toHaveBeenCalled()
  })

  it('rejects a fractional limit with a 400', async () => {
    await loadService()
    await expect(
      service.setWalletTopUpLimitConfig(
        { limit_irr: 1.5 },
        'admin-1',
        '127.0.0.1',
      ),
    ).rejects.toThrowError(HttpException)
  })

  it('rejects a missing limit with a 400', async () => {
    await loadService()
    await expect(
      service.setWalletTopUpLimitConfig({}, 'admin-1', '127.0.0.1'),
    ).rejects.toMatchObject({ status: 400 })
  })

  it('rejects a coercible string limit with a 400 (no silent coercion)', async () => {
    await loadService()
    await expect(
      service.setWalletTopUpLimitConfig(
        { limit_irr: '2000000000' },
        'admin-1',
        '127.0.0.1',
      ),
    ).rejects.toMatchObject({ status: 400 })
  })

  it('persists a valid limit, bumps config version, and records an audit', async () => {
    const { pool, mockConnect } = await loadService()
    const { client } = mockClient()
    mockConnect.mockResolvedValue(client)
    // Call order: BEGIN, SELECT ... FOR UPDATE (no existing row),
    // INSERT RETURNING version, config_version, audit_log, COMMIT
    client.query
      .mockResolvedValueOnce({ rows: [] }) // BEGIN
      .mockResolvedValueOnce({ rows: [] }) // SELECT ... FOR UPDATE
      .mockResolvedValueOnce({ rows: [{ version: 1 }] }) // INSERT RETURNING
      .mockResolvedValueOnce({ rows: [] }) // config_version
      .mockResolvedValueOnce({ rows: [] }) // audit_log
      .mockResolvedValueOnce({ rows: [] }) // COMMIT

    await service.setWalletTopUpLimitConfig(
      { limit_irr: 1_000_000_000 },
      'admin-1',
      '127.0.0.1',
    )

    // BEGIN, SELECT ... FOR UPDATE, INSERT app_config, UPDATE config_version,
    // INSERT audit_log, COMMIT
    expect(mockConnect).toHaveBeenCalledTimes(1)
    const queries = client.query.mock.calls.map((c: unknown[]) => String(c[0]))
    expect(queries[0]!).toMatch(/BEGIN/)
    expect(queries[1]!).toMatch(/SELECT.*app_config.*FOR UPDATE/)
    expect(queries[2]!).toMatch(/INSERT INTO app_config/)
    expect(queries[3]!).toMatch(/config_version/)
    expect(queries[4]!).toMatch(/audit_log/)
    expect(queries[5]!).toMatch(/COMMIT/)

    // The stored value is snake_case and carries the correct key
    const appConfigQuery = client.query.mock.calls[2]!
    expect((appConfigQuery[1] as unknown[])[0]).toBe(WALLET_TOP_UP_LIMIT_CONFIG_KEY)
    const stored = JSON.parse((appConfigQuery[1] as unknown[])[1] as string)
    expect(stored).toEqual({ limit_irr: 1_000_000_000 })

    // The audit metadata records the same key and new value
    const auditQuery = client.query.mock.calls[4]!
    const auditMetadata = JSON.parse((auditQuery[1] as unknown[])[3] as string)
    expect(auditMetadata).toEqual({
      key: WALLET_TOP_UP_LIMIT_CONFIG_KEY,
      previousValue: null,
      previousVersion: 0,
      newValue: { limit_irr: 1_000_000_000 },
      version: 1,
    })

    expect(client.release).toHaveBeenCalledTimes(1)
    expect(pool.query).not.toHaveBeenCalled() // get path does not run on set
  })

  it('records the previous value and version in the audit trail on overwrite', async () => {
    const { mockConnect } = await loadService()
    const { client } = mockClient()
    mockConnect.mockResolvedValue(client)
    // Call order: BEGIN, SELECT ... FOR UPDATE (existing row),
    // INSERT RETURNING version, config_version, audit_log, COMMIT
    client.query
      .mockResolvedValueOnce({ rows: [] }) // BEGIN
      .mockResolvedValueOnce({ rows: [{ value: { limit_irr: 5_000_000_000 }, version: 3 }] })
      .mockResolvedValueOnce({ rows: [{ version: 4 }] })
      .mockResolvedValueOnce({ rows: [] }) // config_version
      .mockResolvedValueOnce({ rows: [] }) // audit_log
      .mockResolvedValueOnce({ rows: [] }) // COMMIT

    await service.setWalletTopUpLimitConfig(
      { limit_irr: 2_000_000_000 },
      'admin-1',
      '127.0.0.1',
    )

    const auditQuery = client.query.mock.calls[4]!
    const auditMetadata = JSON.parse((auditQuery[1] as unknown[])[3] as string)
    expect(auditMetadata).toEqual({
      key: WALLET_TOP_UP_LIMIT_CONFIG_KEY,
      previousValue: { limit_irr: 5_000_000_000 },
      previousVersion: 3,
      newValue: { limit_irr: 2_000_000_000 },
      version: 4,
    })
  })

  it('returns the persisted camelCase config', async () => {
    const { mockConnect } = await loadService()
    const { client } = mockClient()
    mockConnect.mockResolvedValue(client)
    client.query
      .mockResolvedValueOnce({ rows: [] }) // BEGIN
      .mockResolvedValueOnce({ rows: [] }) // SELECT ... FOR UPDATE
      .mockResolvedValueOnce({ rows: [{ version: 1 }] }) // INSERT RETURNING
      .mockResolvedValueOnce({ rows: [] }) // config_version
      .mockResolvedValueOnce({ rows: [] }) // audit_log
      .mockResolvedValueOnce({ rows: [] }) // COMMIT

    const result = await service.setWalletTopUpLimitConfig(
      { limit_irr: 2_000_000_000 },
      'admin-1',
      '127.0.0.1',
    )
    expect(result).toEqual({ limitIrR: 2_000_000_000, version: 1 })
  })

  it('invalidates the versioned config cache after a successful write', async () => {
    const { pool, mockConnect } = await loadService()
    const { client } = mockClient()
    mockConnect.mockResolvedValue(client)
    client.query
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ version: 2 }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
    const invalidate = vi.fn().mockResolvedValue(undefined)
    ;(service as unknown as { configCache: { invalidate: typeof invalidate } }).configCache = {
      invalidate,
    }

    await service.setWalletTopUpLimitConfig(
      { limit_irr: 750_000 },
      'admin-1',
      '127.0.0.1',
    )

    expect(invalidate).toHaveBeenCalledWith(WALLET_TOP_UP_LIMIT_CONFIG_KEY)
    expect(pool.connect).toHaveBeenCalledTimes(1)
  })
})