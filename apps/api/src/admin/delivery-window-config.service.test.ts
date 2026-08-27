import { describe, it, expect, beforeEach, vi } from 'vitest'
import { HttpException } from '@nestjs/common'
import type { AdminService as AdminServiceType } from './admin.service.js'
import { DEFAULT_DELIVERY_WINDOW } from '@barghsa/shared/notifications'

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

// ─── Tests — getDeliveryWindowConfig ──────────────────────────────────

describe('AdminService.getDeliveryWindowConfig (T-05.03.03)', () => {
  it('returns the default window when no value is persisted', async () => {
    const { mockQuery } = await loadService()
    mockQuery.mockResolvedValueOnce({ rows: [] })

    const result = await service.getDeliveryWindowConfig()
    expect(result).toEqual(DEFAULT_DELIVERY_WINDOW)
    expect(mockQuery).toHaveBeenCalledWith(
      expect.stringContaining('app_config'),
      ['notification.delivery_window'],
    )
  })

  it('maps a stored snake_case value to the camelCase window shape', async () => {
    const { mockQuery } = await loadService()
    mockQuery.mockResolvedValueOnce({
      rows: [{ value: { timezone: 'UTC', start_hour: 8, end_hour: 20 } }],
    })

    const result = await service.getDeliveryWindowConfig()
    expect(result).toEqual({ timezone: 'UTC', startHour: 8, endHour: 20 })
  })
})

// ─── Tests — setDeliveryWindowConfig ──────────────────────────────────

describe('AdminService.setDeliveryWindowConfig (T-05.03.03)', () => {
  it('rejects start >= end with a 400', async () => {
    const { pool } = await loadService()
    await expect(
      service.setDeliveryWindowConfig(
        { timezone: 'UTC', start_hour: 21, end_hour: 9 },
        'admin-1',
        '127.0.0.1',
      ),
    ).rejects.toMatchObject({ status: 400 })
    expect(pool.connect).not.toHaveBeenCalled()
  })

  it('rejects a window shorter than 4 hours with a 400', async () => {
    await loadService()
    await expect(
      service.setDeliveryWindowConfig(
        { timezone: 'UTC', start_hour: 9, end_hour: 11 },
        'admin-1',
        '127.0.0.1',
      ),
    ).rejects.toThrowError(HttpException)
  })

  it('rejects an invalid timezone with a 400', async () => {
    await loadService()
    await expect(
      service.setDeliveryWindowConfig(
        { timezone: 'Not/AZone', start_hour: 9, end_hour: 20 },
        'admin-1',
        '127.0.0.1',
      ),
    ).rejects.toMatchObject({ status: 400 })
  })

  it('persists a valid window, bumps config version, and records an audit', async () => {
    const { pool, mockConnect } = await loadService()
    const { client } = mockClient()
    mockConnect.mockResolvedValue(client)

    await service.setDeliveryWindowConfig(
      { timezone: 'Asia/Tehran', start_hour: 8, end_hour: 20 },
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

    // The stored value is snake_case
    const appConfigQuery = client.query.mock.calls[1]!
    const stored = JSON.parse((appConfigQuery[1] as unknown[])[1] as string)
    expect(stored).toEqual({ timezone: 'Asia/Tehran', start_hour: 8, end_hour: 20 })

    expect(client.release).toHaveBeenCalledTimes(1)
    expect(pool.query).not.toHaveBeenCalled() // get path does not run on set
  })

  it('returns the persisted camelCase window', async () => {
    const { mockConnect } = await loadService()
    const { client } = mockClient()
    mockConnect.mockResolvedValue(client)

    const result = await service.setDeliveryWindowConfig(
      { timezone: 'UTC', start_hour: 6, end_hour: 18 },
      'admin-1',
      '127.0.0.1',
    )
    expect(result).toEqual({ timezone: 'UTC', startHour: 6, endHour: 18 })
  })
})
