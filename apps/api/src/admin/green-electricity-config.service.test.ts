import { describe, it, expect, beforeEach, vi } from 'vitest'
import { HttpException } from '@nestjs/common'
import type { AdminService as AdminServiceType } from './admin.service.js'
import {
  DEFAULT_GREEN_ELECTRICITY_CONFIG,
  GREEN_ELECTRICITY_CONFIG_KEY,
} from '@barghsa/shared/finance'

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

const VALID_INPUT = {
  simple_order: {
    mandatory_green_enabled: true,
    average_power_threshold_kw: 1000,
    mandatory_green_share_percent: 4,
  },
  advanced_order: {
    mandatory_green_enabled: false,
    average_power_threshold_kw: 500,
    mandatory_green_share_percent: 10,
  },
}

// ─── Tests — getGreenElectricityConfig ───────────────────────────────

describe('AdminService.getGreenElectricityConfig (T-09.10.02)', () => {
  it('returns the T-09.10.02 defaults when no value is persisted', async () => {
    const { mockQuery } = await loadService()
    mockQuery.mockResolvedValueOnce({ rows: [] })

    const result = await service.getGreenElectricityConfig()
    expect(result).toEqual(DEFAULT_GREEN_ELECTRICITY_CONFIG)
    expect(mockQuery).toHaveBeenCalledWith(
      expect.stringContaining('app_config'),
      [GREEN_ELECTRICITY_CONFIG_KEY],
    )
  })

  it('maps a stored snake_case value to the camelCase config shape', async () => {
    const { mockQuery } = await loadService()
    mockQuery.mockResolvedValueOnce({
      rows: [
        {
          value: {
            simple_order: {
              mandatory_green_enabled: true,
              average_power_threshold_kw: 2000,
              mandatory_green_share_percent: 8,
            },
            advanced_order: {
              mandatory_green_enabled: true,
              average_power_threshold_kw: 1500,
              mandatory_green_share_percent: 5,
            },
          },
        },
      ],
    })

    const result = await service.getGreenElectricityConfig()
    expect(result.simpleOrder).toEqual({
      mandatoryGreenEnabled: true,
      averagePowerThresholdKw: 2000,
      mandatoryGreenSharePercent: 8,
    })
    expect(result.advancedOrder).toEqual({
      mandatoryGreenEnabled: true,
      averagePowerThresholdKw: 1500,
      mandatoryGreenSharePercent: 5,
    })
  })

  it('serves the defaults and warns on a corrupt persisted value', async () => {
    const { mockQuery } = await loadService()
    mockQuery.mockResolvedValueOnce({
      rows: [{ value: { simple_order: 'corrupted' } }],
    })

    const warnSpy = vi.spyOn(service['logger'], 'warn').mockImplementation(() => undefined)
    const result = await service.getGreenElectricityConfig()
    expect(result).toEqual(DEFAULT_GREEN_ELECTRICITY_CONFIG)
    expect(warnSpy).toHaveBeenCalledTimes(1)
  })
})

// ─── Tests — setGreenElectricityConfig ───────────────────────────────

describe('AdminService.setGreenElectricityConfig (T-09.10.02)', () => {
  it('rejects a non-object body with a 400', async () => {
    const { pool } = await loadService()
    await expect(
      service.setGreenElectricityConfig('nope', 'admin-1', '127.0.0.1'),
    ).rejects.toMatchObject({ status: 400 })
    expect(pool.connect).not.toHaveBeenCalled()
  })

  it('rejects a negative threshold with a 400', async () => {
    await loadService()
    await expect(
      service.setGreenElectricityConfig(
        {
          simple_order: { mandatory_green_enabled: true, average_power_threshold_kw: -1, mandatory_green_share_percent: 4 },
          advanced_order: VALID_INPUT.advanced_order,
        },
        'admin-1',
        '127.0.0.1',
      ),
    ).rejects.toThrowError(HttpException)
  })

  it('rejects a share above 100 with a 400', async () => {
    await loadService()
    await expect(
      service.setGreenElectricityConfig(
        {
          simple_order: { mandatory_green_enabled: true, average_power_threshold_kw: 1000, mandatory_green_share_percent: 101 },
          advanced_order: VALID_INPUT.advanced_order,
        },
        'admin-1',
        '127.0.0.1',
      ),
    ).rejects.toMatchObject({ status: 400 })
  })

  it('rejects a coercible string threshold with a 400 (no silent coercion)', async () => {
    await loadService()
    await expect(
      service.setGreenElectricityConfig(
        {
          simple_order: { mandatory_green_enabled: true, average_power_threshold_kw: '1000', mandatory_green_share_percent: 4 },
          advanced_order: VALID_INPUT.advanced_order,
        },
        'admin-1',
        '127.0.0.1',
      ),
    ).rejects.toMatchObject({ status: 400 })
  })

  it('persists the config, bumps config version, and records an audit', async () => {
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

    await service.setGreenElectricityConfig(VALID_INPUT, 'admin-1', '127.0.0.1')

    expect(mockConnect).toHaveBeenCalledTimes(1)
    const queries = client.query.mock.calls.map((c: unknown[]) => String(c[0]))
    expect(queries[0]!).toMatch(/BEGIN/)
    expect(queries[1]!).toMatch(/SELECT.*app_config.*FOR UPDATE/)
    expect(queries[2]!).toMatch(/INSERT INTO app_config/)
    expect(queries[3]!).toMatch(/config_version/)
    expect(queries[4]!).toMatch(/audit_log/)
    expect(queries[5]!).toMatch(/COMMIT/)

    const appConfigQuery = client.query.mock.calls[2]!
    expect((appConfigQuery[1] as unknown[])[0]).toBe(GREEN_ELECTRICITY_CONFIG_KEY)
    const stored = JSON.parse((appConfigQuery[1] as unknown[])[1] as string)
    expect(stored).toEqual({
      simple_order: { mandatory_green_enabled: true, average_power_threshold_kw: 1000, mandatory_green_share_percent: 4 },
      advanced_order: { mandatory_green_enabled: false, average_power_threshold_kw: 500, mandatory_green_share_percent: 10 },
    })

    const auditQuery = client.query.mock.calls[4]!
    const auditMetadata = JSON.parse((auditQuery[1] as unknown[])[3] as string)
    expect(auditMetadata).toEqual({
      key: GREEN_ELECTRICITY_CONFIG_KEY,
      previousValue: null,
      previousVersion: 0,
      newValue: stored,
      version: 1,
    })

    expect(client.release).toHaveBeenCalledTimes(1)
    expect(pool.query).not.toHaveBeenCalled() // get path does not run on set
  })

  it('records the previous value and version in the audit trail on overwrite', async () => {
    const { mockConnect } = await loadService()
    const { client } = mockClient()
    mockConnect.mockResolvedValue(client)
    client.query
      .mockResolvedValueOnce({ rows: [] }) // BEGIN
      .mockResolvedValueOnce({
        rows: [
          {
            value: {
              simple_order: { mandatory_green_enabled: false, average_power_threshold_kw: 1000, mandatory_green_share_percent: 4 },
              advanced_order: { mandatory_green_enabled: false, average_power_threshold_kw: 1000, mandatory_green_share_percent: 4 },
            },
            version: 3,
          },
        ],
      })
      .mockResolvedValueOnce({ rows: [{ version: 4 }] })
      .mockResolvedValueOnce({ rows: [] }) // config_version
      .mockResolvedValueOnce({ rows: [] }) // audit_log
      .mockResolvedValueOnce({ rows: [] }) // COMMIT

    await service.setGreenElectricityConfig(VALID_INPUT, 'admin-1', '127.0.0.1')

    const auditQuery = client.query.mock.calls[4]!
    const auditMetadata = JSON.parse((auditQuery[1] as unknown[])[3] as string)
    expect(auditMetadata.key).toBe(GREEN_ELECTRICITY_CONFIG_KEY)
    expect(auditMetadata.previousVersion).toBe(3)
    expect(auditMetadata.version).toBe(4)
    expect(auditMetadata.previousValue).toEqual({
      simple_order: { mandatory_green_enabled: false, average_power_threshold_kw: 1000, mandatory_green_share_percent: 4 },
      advanced_order: { mandatory_green_enabled: false, average_power_threshold_kw: 1000, mandatory_green_share_percent: 4 },
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

    const result = await service.setGreenElectricityConfig(VALID_INPUT, 'admin-1', '127.0.0.1')
    expect(result.simpleOrder).toEqual({
      mandatoryGreenEnabled: true,
      averagePowerThresholdKw: 1000,
      mandatoryGreenSharePercent: 4,
    })
    expect(result.advancedOrder).toEqual({
      mandatoryGreenEnabled: false,
      averagePowerThresholdKw: 500,
      mandatoryGreenSharePercent: 10,
    })
  })
})
