import { describe, it, expect, beforeEach, vi } from 'vitest'
import { HttpException } from '@nestjs/common'
import type { AdminService as AdminServiceType } from './admin.service.js'
import {
  DEFAULT_ESCALATION_POLICIES,
  ESCALATION_POLICY_CONFIG_KEY,
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

const SAMPLE_POLICY = {
  ticket: {
    level2: { delayHours: 24, channels: ['in_app', 'email'] },
    level3: { delayHours: 48, channels: ['in_app'] },
  },
  verification_case: null,
}

// ─── Tests — getEscalationPolicy (T-09.08.03) ─────────────────────────

describe('AdminService.getEscalationPolicy (T-09.08.03)', () => {
  it('returns the all-disabled default when no value is persisted', async () => {
    const { mockQuery } = await loadService()
    mockQuery.mockResolvedValueOnce({ rows: [] })

    const result = await service.getEscalationPolicy()
    expect(result).toEqual(DEFAULT_ESCALATION_POLICIES)
    expect(mockQuery).toHaveBeenCalledWith(
      expect.stringContaining('app_config'),
      [ESCALATION_POLICY_CONFIG_KEY],
    )
  })

  it('returns the stored policy as-is when valid', async () => {
    const { mockQuery } = await loadService()
    mockQuery.mockResolvedValueOnce({ rows: [{ value: SAMPLE_POLICY }] })

    const result = await service.getEscalationPolicy()
    expect(result).toEqual(SAMPLE_POLICY)
  })

  it('fills omitted service types from a stored map with null (disabled)', async () => {
    const { mockQuery } = await loadService()
    const partial = {
      ticket: {
        level2: { delayHours: 24, channels: ['in_app'] },
        level3: { delayHours: 48, channels: ['in_app'] },
      },
    }
    mockQuery.mockResolvedValueOnce({ rows: [{ value: partial }] })

    const result = await service.getEscalationPolicy()
    expect(result.ticket).toEqual(partial.ticket)
    expect(result.verification_case).toBeNull()
  })

  it('serves normalized values and warns on a corrupt persisted value', async () => {
    const { mockQuery } = await loadService()
    // level2 has a 0 delay (corrupt) and level3 is a scalar (corrupt).
    mockQuery.mockResolvedValueOnce({
      rows: [
        {
          value: {
            ticket: {
              level2: { delayHours: 0, channels: ['in_app'] },
              level3: 'escalate!',
            },
          },
        },
      ],
    })

    const warnSpy = vi.spyOn(service['logger'], 'warn').mockImplementation(() => undefined)
    const result = await service.getEscalationPolicy()
    // Both levels degrade to disabled defaults; the whole type still normalizes.
    expect(result.ticket).toEqual({
      level2: { delayHours: null, channels: ['in_app'] },
      level3: { delayHours: null, channels: ['in_app'] },
    })
    expect(warnSpy).toHaveBeenCalledTimes(1)
  })

  it('keeps valid service types and disables only the corrupt ones in a mixed stored value', async () => {
    const { mockQuery } = await loadService()
    // ticket is valid; verification_case is corrupt.
    mockQuery.mockResolvedValueOnce({
      rows: [
        {
          value: {
            ticket: null,
            verification_case: { level2: [], level3: [] },
          },
        },
      ],
    })

    const warnSpy = vi.spyOn(service['logger'], 'warn').mockImplementation(() => undefined)
    const result = await service.getEscalationPolicy()
    // ticket.value is null → disabled (normalized identically). verification_case
    // normalizes to a policy with disabled levels.
    expect(result.ticket).toBeNull()
    expect(result.verification_case).toEqual({
      level2: { delayHours: null, channels: ['in_app'] },
      level3: { delayHours: null, channels: ['in_app'] },
    })
    expect(warnSpy).toHaveBeenCalledTimes(1)
  })
})

// ─── Tests — setEscalationPolicy (T-09.08.03) ────────────────────────

describe('AdminService.setEscalationPolicy (T-09.08.03)', () => {
  it('rejects an unknown service type with a 400', async () => {
    const { pool } = await loadService()
    await expect(
      service.setEscalationPolicy(
        { ticket: { level2: { delayHours: 24, channels: ['in_app'] }, level3: { delayHours: 48, channels: ['in_app'] } }, consultation: 24 },
        'admin-1',
        '127.0.0.1',
      ),
    ).rejects.toMatchObject({ status: 400 })
    expect(pool.connect).not.toHaveBeenCalled()
  })

  it('rejects a level with missing in_app channel with a 400', async () => {
    await loadService()
    await expect(
      service.setEscalationPolicy(
        { ticket: { level2: { delayHours: 24, channels: ['email'] }, level3: { delayHours: 48, channels: ['in_app'] } } },
        'admin-1',
        '127.0.0.1',
      ),
    ).rejects.toThrowError(HttpException)
  })

  it('rejects zero, fractional, and out-of-range delays with a 400', async () => {
    await loadService()
    for (const bad of [0, -1, 1.5, 8761, '24']) {
      await expect(
        service.setEscalationPolicy(
          { ticket: { level2: { delayHours: bad, channels: ['in_app'] }, level3: { delayHours: 48, channels: ['in_app'] } } },
          'admin-1',
          '127.0.0.1',
        ),
      ).rejects.toThrowError(HttpException)
    }
  })

  it('rejects a non-object payload with a 400', async () => {
    await loadService()
    await expect(
      service.setEscalationPolicy(48 as unknown, 'admin-1', '127.0.0.1'),
    ).rejects.toMatchObject({ status: 400 })
  })

  it('accepts null to disable a service type', async () => {
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

    const result = await service.setEscalationPolicy(
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
    client.query
      .mockResolvedValueOnce({ rows: [] }) // BEGIN
      .mockResolvedValueOnce({
        rows: [{ value: { ticket: null }, version: 2 }],
      }) // SELECT ... FOR UPDATE
      .mockResolvedValueOnce({ rows: [{ version: 3 }] }) // INSERT RETURNING
      .mockResolvedValueOnce({ rows: [] }) // config_version
      .mockResolvedValueOnce({ rows: [] }) // audit_log
      .mockResolvedValueOnce({ rows: [] }) // COMMIT

    const result = await service.setEscalationPolicy(SAMPLE_POLICY, 'admin-1', '127.0.0.1')
    expect(result).toEqual(SAMPLE_POLICY)

    const auditCall = client.query.mock.calls.find(([sql]) =>
      String(sql).includes('audit_log'),
    )
    expect(auditCall).toBeDefined()
    const auditParams = auditCall![1] as unknown[]
    expect(auditParams[2]).toBe('config_change')
    const metadata = JSON.parse(String(auditParams[3])) as Record<string, unknown>
    expect(metadata).toMatchObject({
      key: ESCALATION_POLICY_CONFIG_KEY,
      previousValue: { ticket: null },
      previousVersion: 2,
      newValue: SAMPLE_POLICY,
      version: 3,
    })

    expect(
      client.query.mock.calls.some(([sql]) => String(sql).includes('config_version')),
    ).toBe(true)
  })
})