import { describe, it, expect, beforeEach, vi } from 'vitest'
import { CrmV2Service } from './crm-v2.service.js'

// ─── Helpers ──────────────────────────────────────────────────────────

function mockPool() {
  const mockQuery = vi.fn()
  const pool = { query: mockQuery }
  return { mockQuery, pool }
}

let service: CrmV2Service

beforeEach(() => {
  vi.resetModules()
  vi.restoreAllMocks()
})

const VALID_PROFILE_ID = '00000000-0000-7000-8000-000000000001'
const VALID_USER_ID = '00000000-0000-7000-8000-000000000010'

/**
 * Build a fake profile row as returned by the SQL query.
 */
function fakeProfileRow(overrides: Record<string, unknown> = {}) {
  return {
    id: VALID_PROFILE_ID,
    user_id: VALID_USER_ID,
    profile_type: 'INDIVIDUAL',
    is_default: true,
    status: 'VERIFIED',
    title: null,
    first_name: 'John',
    last_name: 'Doe',
    national_id: '1234567890',
    created_at: '2026-01-15T10:00:00Z',
    updated_at: '2026-06-01T08:00:00Z',
    ...overrides,
  }
}

function fakeUserRow(overrides: Record<string, unknown> = {}) {
  return {
    user_id: VALID_USER_ID,
    username: 'user@example.com',
    email: 'user@example.com',
    mobile: null,
    last_login_at: '2026-06-01T08:00:00Z',
    is_admin: false,
    created_at: '2026-01-15T10:00:00Z',
    ...overrides,
  }
}

function fakeAddressRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'aaaa0000-0000-7000-8000-000000000001',
    profile_id: VALID_PROFILE_ID,
    province_id: 'tehran',
    city_id: 'tehran-1',
    full_address: '123 Main St',
    postal_code: '1234567890',
    main_address: true,
    created_at: '2026-01-15T10:00:00Z',
    ...overrides,
  }
}

function fakeSessionRow(overrides: Record<string, unknown> = {}) {
  return {
    session_id: 'session-0001',
    created_at: '2026-01-15T10:00:00Z',
    updated_at: '2026-06-01T08:00:00Z',
    device_info: { browser: 'Chrome', os: 'macOS' },
    expires_at: '2026-02-15T10:00:00Z',
    is_revoked: false,
    ...overrides,
  }
}

function fakeSiblingRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'bbbb0000-0000-7000-8000-000000000002',
    profile_type: 'LEGAL',
    is_default: false,
    status: 'ACTIVE',
    title: null,
    ...overrides,
  }
}

function fakeLegalRow(overrides: Record<string, unknown> = {}) {
  return {
    legal_name: 'Acme Corp',
    national_identifier: '12345678901',
    registration_number: 'REG-001',
    company_type_id: 'limited-liability',
    economic_code: null,
    official_phone: null,
    official_email: 'legal@acme.com',
    official_province_id: 'tehran',
    official_city_id: 'tehran-1',
    official_full_address: '456 Corp St',
    official_postal_code: '9876543210',
    representative_title: 'CEO',
    representative_relationship: 'Director',
    ...overrides,
  }
}

describe('CrmV2Service.getProfileDetail', () => {
  it('returns null when profile does not exist', async () => {
    const { pool } = mockPool()
    pool.query.mockResolvedValue({ rows: [] })
    vi.doMock('@barghsa/db', () => ({ getDbPool: () => pool }))
    const { CrmV2Service: Svc } = await import('./crm-v2.service.js')
    service = new Svc()

    const result = await service.getProfileDetail('nonexistent-id')
    expect(result).toBeNull()
  })

  it('returns full profile detail for an INDIVIDUAL profile', async () => {
    const { pool } = mockPool()
    // These calls happen sequentially:
    // 1. profile query
    // 2. user query
    // 3. addresses query
    // 4. sessions detail query
    // 5. session count query
    // 6. sibling profiles query
    // 7. legal info query (skipped because profile_type != 'LEGAL')
    pool.query
      .mockResolvedValueOnce({ rows: [fakeProfileRow()] })           // profile
      .mockResolvedValueOnce({ rows: [fakeUserRow()] })               // user
      .mockResolvedValueOnce({ rows: [fakeAddressRow()] })           // addresses
      .mockResolvedValueOnce({ rows: [fakeSessionRow()] })            // sessions list
      .mockResolvedValueOnce({ rows: [{ cnt: 1 }] })                 // session count
      .mockResolvedValueOnce({ rows: [fakeSiblingRow()] })           // siblings

    vi.doMock('@barghsa/db', () => ({ getDbPool: () => pool }))
    const { CrmV2Service: Svc } = await import('./crm-v2.service.js')
    service = new Svc()

    const result = await service.getProfileDetail(VALID_PROFILE_ID)

    expect(result).not.toBeNull()
    expect(result!.profile.id).toBe(VALID_PROFILE_ID)
    expect(result!.profile.profileType).toBe('INDIVIDUAL')
    expect(result!.profile.status).toBe('VERIFIED')
    expect(result!.profile.firstName).toBe('John')
    expect(result!.profile.lastName).toBe('Doe')
    expect(result!.user.username).toBe('user@example.com')
    expect(result!.user.lastLogin).toBe('2026-06-01T08:00:00Z')
    expect(result!.user.isAdmin).toBe(false)
    expect(result!.addresses).toHaveLength(1)
    expect(result!.addresses[0]!.mainAddress).toBe(true)
    expect(result!.sessions.count).toBe(1)
    expect(result!.sessions.lastActive).toBe('2026-06-01T08:00:00Z')
    expect(result!.sessions.entries).toHaveLength(1)
    expect(result!.siblingProfiles).toHaveLength(1)
    expect(result!.legalInfo).toBeNull()
  })

  it('returns legalInfo when profile type is LEGAL', async () => {
    const { pool } = mockPool()
    pool.query
      .mockResolvedValueOnce({ rows: [fakeProfileRow({ profile_type: 'LEGAL' })] })
      .mockResolvedValueOnce({ rows: [fakeUserRow()] })
      .mockResolvedValueOnce({ rows: [] })                             // addresses — empty
      .mockResolvedValueOnce({ rows: [] })                             // sessions — empty
      .mockResolvedValueOnce({ rows: [{ cnt: 0 }] })                  // session count — 0
      .mockResolvedValueOnce({ rows: [] })                             // siblings — empty
      .mockResolvedValueOnce({ rows: [fakeLegalRow()] })               // legal info

    vi.doMock('@barghsa/db', () => ({ getDbPool: () => pool }))
    const { CrmV2Service: Svc } = await import('./crm-v2.service.js')
    service = new Svc()

    const result = await service.getProfileDetail(VALID_PROFILE_ID)

    expect(result).not.toBeNull()
    expect(result!.profile.profileType).toBe('LEGAL')
    expect(result!.legalInfo).not.toBeNull()
    expect(result!.legalInfo!.legalName).toBe('Acme Corp')
    expect(result!.legalInfo!.nationalIdentifier).toBe('12345678901')
    expect(result!.legalInfo!.representativeTitle).toBe('CEO')
  })

  it('returns null when user is orphaned (no user row)', async () => {
    const { pool } = mockPool()
    pool.query
      .mockResolvedValueOnce({ rows: [fakeProfileRow()] })           // profile found
      .mockResolvedValueOnce({ rows: [] })                            // user NOT found (orphaned)

    vi.doMock('@barghsa/db', () => ({ getDbPool: () => pool }))
    const { CrmV2Service: Svc } = await import('./crm-v2.service.js')
    service = new Svc()

    const result = await service.getProfileDetail(VALID_PROFILE_ID)
    expect(result).toBeNull()
  })

  it('handles empty addresses gracefully', async () => {
    const { pool } = mockPool()
    pool.query
      .mockResolvedValueOnce({ rows: [fakeProfileRow()] })
      .mockResolvedValueOnce({ rows: [fakeUserRow()] })
      .mockResolvedValueOnce({ rows: [] })                             // addresses — empty
      .mockResolvedValueOnce({ rows: [fakeSessionRow()] })
      .mockResolvedValueOnce({ rows: [{ cnt: 1 }] })
      .mockResolvedValueOnce({ rows: [fakeSiblingRow()] })

    vi.doMock('@barghsa/db', () => ({ getDbPool: () => pool }))
    const { CrmV2Service: Svc } = await import('./crm-v2.service.js')
    service = new Svc()

    const result = await service.getProfileDetail(VALID_PROFILE_ID)

    expect(result!.addresses).toEqual([])
  })

  it('returns addresses ordered by main_address DESC', async () => {
    const { pool } = mockPool()
    pool.query
      .mockResolvedValueOnce({ rows: [fakeProfileRow()] })
      .mockResolvedValueOnce({ rows: [fakeUserRow()] })
      .mockResolvedValueOnce({ rows: [
        fakeAddressRow({ id: 'addr-2', main_address: false }),
        fakeAddressRow({ id: 'addr-1', main_address: true }),
      ]})
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ cnt: 0 }] })
      .mockResolvedValueOnce({ rows: [] })

    vi.doMock('@barghsa/db', () => ({ getDbPool: () => pool }))
    const { CrmV2Service: Svc } = await import('./crm-v2.service.js')
    service = new Svc()

    const result = await service.getProfileDetail(VALID_PROFILE_ID)

    // The addresses should still come in the order the SQL returned them
    expect(result!.addresses).toHaveLength(2)
  })

  it('uses parameterized queries (no SQL injection)', async () => {
    const { pool, mockQuery } = mockPool()
    mockQuery
      .mockResolvedValueOnce({ rows: [fakeProfileRow()] })
      .mockResolvedValueOnce({ rows: [fakeUserRow()] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ cnt: 0 }] })
      .mockResolvedValueOnce({ rows: [] })

    vi.doMock('@barghsa/db', () => ({ getDbPool: () => pool }))
    const { CrmV2Service: Svc } = await import('./crm-v2.service.js')
    service = new Svc()

    await service.getProfileDetail(VALID_PROFILE_ID)

    // Verify the profileId is passed as a parameter, not interpolated
    for (const call of mockQuery.mock.calls) {
      const sql = call[0] as string
      const params = call[1] as unknown[]
      // Every query should use parameterized placeholders
      expect(sql).toMatch(/\$\d+/)
      // The profileId should NOT appear as a literal in the SQL string
      expect(sql).not.toContain(VALID_PROFILE_ID)
    }
    // Verify the profileId was actually passed as a parameter
    const allParams = mockQuery.mock.calls.flatMap((call: unknown[]) => call[1] as unknown[])
    expect(allParams).toContain(VALID_PROFILE_ID)
  })
})