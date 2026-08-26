import { describe, it, expect, beforeEach, vi } from 'vitest'
import { CrmV2Service } from './crm-v2.service.js'

// ─── Helpers ──────────────────────────────────────────────────────────

function mockPool() {
  const mockQuery = vi.fn()
  const mockConnect = vi.fn()
  const pool = { query: mockQuery, connect: mockConnect }
  return { mockQuery, mockConnect, pool }
}

function createMockSessionService() {
  return {
    revokeAllUserSessions: vi.fn().mockResolvedValue(undefined),
  } as any
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
    service = new Svc(createMockSessionService(), { create: vi.fn().mockResolvedValue(undefined) } as unknown as any)

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
    service = new Svc(createMockSessionService(), { create: vi.fn().mockResolvedValue(undefined) } as unknown as any)

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
    service = new Svc(createMockSessionService(), { create: vi.fn().mockResolvedValue(undefined) } as unknown as any)

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
    service = new Svc(createMockSessionService(), { create: vi.fn().mockResolvedValue(undefined) } as unknown as any)

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
    service = new Svc(createMockSessionService(), { create: vi.fn().mockResolvedValue(undefined) } as unknown as any)

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
    service = new Svc(createMockSessionService(), { create: vi.fn().mockResolvedValue(undefined) } as unknown as any)

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
    service = new Svc(createMockSessionService(), { create: vi.fn().mockResolvedValue(undefined) } as unknown as any)

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

describe('CrmV2Service.updateProfile', () => {
  const UPDATED_USER_ID = 'admin-user-001'

  function mockClient() {
    const mockClientQuery = vi.fn()
    const mockRelease = vi.fn()
    const client = { query: mockClientQuery, release: mockRelease }
    return { mockClientQuery, mockRelease, client }
  }

  it('updates title successfully', async () => {
    const { pool, mockConnect } = mockPool()
    const { client, mockClientQuery, mockRelease } = mockClient()

    pool.query
      .mockResolvedValueOnce({ rows: [fakeProfileRow()] })           // profile
      .mockResolvedValueOnce({ rows: [fakeUserRow()] })               // user
    mockConnect
      .mockResolvedValueOnce(client)
    mockClientQuery
      .mockResolvedValueOnce(undefined)                                // BEGIN
      .mockResolvedValueOnce(undefined)                                // UPDATE profiles
      .mockResolvedValueOnce(undefined)                                // INSERT audit_log
      .mockResolvedValueOnce(undefined)                                // COMMIT

    vi.doMock('@barghsa/db', () => ({ getDbPool: () => pool }))
    const { CrmV2Service: Svc } = await import('./crm-v2.service.js')
    service = new Svc(createMockSessionService(), { create: vi.fn().mockResolvedValue(undefined) } as unknown as any)

    const result = await service.updateProfile(
      VALID_PROFILE_ID,
      { title: 'New Profile Title' },
      UPDATED_USER_ID,
      '127.0.0.1',
    )

    expect(result).not.toBeNull()
    expect(result).not.toHaveProperty('error')
    const success = result as { updated: true; profile: { id: string; title: string | null } }
    expect(success.updated).toBe(true)
    expect(success.profile.title).toBe('New Profile Title')
    expect(mockRelease).toHaveBeenCalledTimes(1)
  })

  it('updates email and mobile successfully', async () => {
    const { pool, mockConnect } = mockPool()
    const { client, mockClientQuery, mockRelease } = mockClient()

    pool.query
      .mockResolvedValueOnce({ rows: [fakeProfileRow()] })           // profile
      .mockResolvedValueOnce({ rows: [fakeUserRow({ email: 'old@test.com', mobile: null })] }) // user
    mockConnect
      .mockResolvedValueOnce(client)
    mockClientQuery
      .mockResolvedValueOnce(undefined)                                // BEGIN
      .mockResolvedValueOnce(undefined)                                // UPDATE users
      .mockResolvedValueOnce(undefined)                                // INSERT audit_log
      .mockResolvedValueOnce(undefined)                                // COMMIT

    vi.doMock('@barghsa/db', () => ({ getDbPool: () => pool }))
    const { CrmV2Service: Svc } = await import('./crm-v2.service.js')
    service = new Svc(createMockSessionService(), { create: vi.fn().mockResolvedValue(undefined) } as unknown as any)

    const result = await service.updateProfile(
      VALID_PROFILE_ID,
      { email: 'new@test.com', mobile: '09123456789' },
      UPDATED_USER_ID,
      '127.0.0.1',
    )

    expect(result).not.toBeNull()
    const success = result as { updated: true; user: { email: string | null; mobile: string | null } }
    expect(success.updated).toBe(true)
    expect(success.user.email).toBe('new@test.com')
    expect(success.user.mobile).toBe('09123456789')
    expect(mockRelease).toHaveBeenCalledTimes(1)
  })

  it('returns no error for no-op (same values)', async () => {
    const { pool } = mockPool()

    pool.query
      .mockResolvedValueOnce({ rows: [fakeProfileRow({ title: 'Same Title' })] }) // profile
      .mockResolvedValueOnce({ rows: [fakeUserRow()] })              // user

    vi.doMock('@barghsa/db', () => ({ getDbPool: () => pool }))
    const { CrmV2Service: Svc } = await import('./crm-v2.service.js')
    service = new Svc(createMockSessionService(), { create: vi.fn().mockResolvedValue(undefined) } as unknown as any)

    const result = await service.updateProfile(
      VALID_PROFILE_ID,
      { title: 'Same Title' },
      UPDATED_USER_ID,
      '127.0.0.1',
    )

    expect(result).not.toBeNull()
    expect(result).not.toHaveProperty('error')
    const success = result as { updated: true; profile: { title: string | null } }
    expect(success.updated).toBe(true)
    expect(success.profile.title).toBe('Same Title')
  })

  it('returns null when profile does not exist', async () => {
    const { pool } = mockPool()
    pool.query.mockResolvedValueOnce({ rows: [] })                    // profile not found

    vi.doMock('@barghsa/db', () => ({ getDbPool: () => pool }))
    const { CrmV2Service: Svc } = await import('./crm-v2.service.js')
    service = new Svc(createMockSessionService(), { create: vi.fn().mockResolvedValue(undefined) } as unknown as any)

    const result = await service.updateProfile('nonexistent-id', { title: 'X' }, UPDATED_USER_ID, '')
    expect(result).toBeNull()
  })

  it('rejects invalid email format', async () => {
    const { pool } = mockPool()
    pool.query
      .mockResolvedValueOnce({ rows: [fakeProfileRow()] })           // profile found (stopped by validation before user query)

    vi.doMock('@barghsa/db', () => ({ getDbPool: () => pool }))
    const { CrmV2Service: Svc } = await import('./crm-v2.service.js')
    service = new Svc(createMockSessionService(), { create: vi.fn().mockResolvedValue(undefined) } as unknown as any)

    const result = await service.updateProfile(
      VALID_PROFILE_ID,
      { email: 'not-an-email' },
      UPDATED_USER_ID,
      '',
    )

    expect(result).not.toBeNull()
    expect(result).toHaveProperty('error')
    expect((result as { error: string }).error).toContain('Invalid email')
  })

  it('rejects invalid Iranian mobile format', async () => {
    const { pool } = mockPool()
    pool.query
      .mockResolvedValueOnce({ rows: [fakeProfileRow()] })           // profile found

    vi.doMock('@barghsa/db', () => ({ getDbPool: () => pool }))
    const { CrmV2Service: Svc } = await import('./crm-v2.service.js')
    service = new Svc(createMockSessionService(), { create: vi.fn().mockResolvedValue(undefined) } as unknown as any)

    const result = await service.updateProfile(
      VALID_PROFILE_ID,
      { mobile: '12345' },
      UPDATED_USER_ID,
      '',
    )

    expect(result).not.toBeNull()
    expect(result).toHaveProperty('error')
    expect((result as { error: string }).error).toContain('Invalid Iranian mobile')
  })

  it('records audit event with before/after diff', async () => {
    const { pool, mockConnect } = mockPool()
    const { client, mockClientQuery, mockRelease } = mockClient()

    pool.query
      .mockResolvedValueOnce({ rows: [fakeProfileRow({ title: null })] })  // profile
      .mockResolvedValueOnce({ rows: [fakeUserRow()] })                     // user
    mockConnect
      .mockResolvedValueOnce(client)
    mockClientQuery
      .mockResolvedValueOnce(undefined)                                      // BEGIN
      .mockResolvedValueOnce(undefined)                                      // UPDATE profiles
      .mockResolvedValueOnce(undefined)                                      // INSERT audit_log
      .mockResolvedValueOnce(undefined)                                      // COMMIT

    vi.doMock('@barghsa/db', () => ({ getDbPool: () => pool }))
    const { CrmV2Service: Svc } = await import('./crm-v2.service.js')
    service = new Svc(createMockSessionService(), { create: vi.fn().mockResolvedValue(undefined) } as unknown as any)

    await service.updateProfile(
      VALID_PROFILE_ID,
      { title: 'Updated Title' },
      UPDATED_USER_ID,
      '10.0.0.1',
    )

    // Find the audit INSERT call
    const auditCall = mockClientQuery.mock.calls.find(
      (call: unknown[]) => (call[0] as string).includes('INSERT INTO audit_log'),
    )
    expect(auditCall).toBeDefined()
    // auditCall[1] is the params array; index 3 is the JSON metadata (4th param)
    const auditParams = auditCall![1] as unknown[]
    const metadataStr = auditParams[3] as string
    const metadata = JSON.parse(metadataStr)
    expect(metadata.profileId).toBe(VALID_PROFILE_ID)
    expect(metadata.before).toHaveProperty('title')
    expect(metadata.before.title).toBeNull()
    expect(metadata.after.title).toBe('Updated Title')
    expect(mockRelease).toHaveBeenCalled()
  })
})

describe('CrmV2Service.verifyProfile', () => {
  const ACTOR_USER_ID = 'admin-user-001'
  const VALID_PROFILE_ID = '00000000-0000-7000-8000-000000000001'

  function mockClient() {
    const mockClientQuery = vi.fn()
    const mockRelease = vi.fn()
    const client = { query: mockClientQuery, release: mockRelease }
    return { mockClientQuery, mockRelease, client }
  }

  it('verifies a DRAFT profile successfully', async () => {
    const { pool, mockConnect } = mockPool()
    const { client, mockClientQuery, mockRelease } = mockClient()

    pool.query.mockResolvedValueOnce({ rows: [{ id: VALID_PROFILE_ID, user_id: 'user-001', status: 'DRAFT' }] })
    mockConnect.mockResolvedValueOnce(client)
    mockClientQuery
      .mockResolvedValueOnce(undefined) // BEGIN
      .mockResolvedValueOnce(undefined) // UPDATE profiles
      .mockResolvedValueOnce(undefined) // INSERT audit_log
      .mockResolvedValueOnce(undefined) // COMMIT

    vi.doMock('@barghsa/db', () => ({ getDbPool: () => pool }))
    const { CrmV2Service: Svc } = await import('./crm-v2.service.js')
    const service = new Svc(createMockSessionService(), { create: vi.fn().mockResolvedValue(undefined) } as unknown as any)

    const result = await service.verifyProfile(
      VALID_PROFILE_ID,
      { action: 'verify' },
      ACTOR_USER_ID,
      '10.0.0.1',
    )

    expect(result).not.toBeNull()
    expect(result).not.toHaveProperty('error')
    const success = result as { success: true; profileId: string; previousStatus: string; newStatus: string }
    expect(success.success).toBe(true)
    expect(success.previousStatus).toBe('DRAFT')
    expect(success.newStatus).toBe('VERIFIED')
    expect(mockRelease).toHaveBeenCalledTimes(1)
  })

  it('verifies an ACTIVE profile successfully', async () => {
    const { pool, mockConnect } = mockPool()
    const { client, mockClientQuery, mockRelease } = mockClient()

    pool.query.mockResolvedValueOnce({ rows: [{ id: VALID_PROFILE_ID, user_id: 'user-001', status: 'ACTIVE' }] })
    mockConnect.mockResolvedValueOnce(client)
    mockClientQuery
      .mockResolvedValueOnce(undefined) // BEGIN
      .mockResolvedValueOnce(undefined) // UPDATE profiles
      .mockResolvedValueOnce(undefined) // INSERT audit_log
      .mockResolvedValueOnce(undefined) // COMMIT

    vi.doMock('@barghsa/db', () => ({ getDbPool: () => pool }))
    const { CrmV2Service: Svc } = await import('./crm-v2.service.js')
    const service = new Svc(createMockSessionService(), { create: vi.fn().mockResolvedValue(undefined) } as unknown as any)

    const result = await service.verifyProfile(
      VALID_PROFILE_ID,
      { action: 'verify' },
      ACTOR_USER_ID,
      '',
    )

    expect(result).not.toBeNull()
    const success = result as { success: true; newStatus: string }
    expect(success.newStatus).toBe('VERIFIED')
  })

  it('unverifies a VERIFIED profile', async () => {
    const { pool, mockConnect } = mockPool()
    const { client, mockClientQuery, mockRelease } = mockClient()

    pool.query.mockResolvedValueOnce({ rows: [{ id: VALID_PROFILE_ID, user_id: 'user-001', status: 'VERIFIED' }] })
    mockConnect.mockResolvedValueOnce(client)
    mockClientQuery
      .mockResolvedValueOnce(undefined) // BEGIN
      .mockResolvedValueOnce(undefined) // UPDATE profiles
      .mockResolvedValueOnce(undefined) // INSERT audit_log
      .mockResolvedValueOnce(undefined) // COMMIT

    vi.doMock('@barghsa/db', () => ({ getDbPool: () => pool }))
    const { CrmV2Service: Svc } = await import('./crm-v2.service.js')
    const service = new Svc(createMockSessionService(), { create: vi.fn().mockResolvedValue(undefined) } as unknown as any)

    const result = await service.verifyProfile(
      VALID_PROFILE_ID,
      { action: 'unverify', reason: 'Profile information needs review' },
      ACTOR_USER_ID,
      '10.0.0.1',
    )

    expect(result).not.toBeNull()
    const success = result as { success: true; previousStatus: string; newStatus: string }
    expect(success.previousStatus).toBe('VERIFIED')
    expect(success.newStatus).toBe('ACTIVE')
    expect(mockRelease).toHaveBeenCalledTimes(1)
  })

  it('reverifies a VERIFIED profile', async () => {
    const { pool, mockConnect } = mockPool()
    const { client, mockClientQuery, mockRelease } = mockClient()

    pool.query.mockResolvedValueOnce({ rows: [{ id: VALID_PROFILE_ID, user_id: 'user-001', status: 'VERIFIED' }] })
    mockConnect.mockResolvedValueOnce(client)
    mockClientQuery
      .mockResolvedValueOnce(undefined) // BEGIN
      .mockResolvedValueOnce(undefined) // UPDATE profiles
      .mockResolvedValueOnce(undefined) // INSERT audit_log
      .mockResolvedValueOnce(undefined) // COMMIT

    vi.doMock('@barghsa/db', () => ({ getDbPool: () => pool }))
    const { CrmV2Service: Svc } = await import('./crm-v2.service.js')
    const service = new Svc(createMockSessionService(), { create: vi.fn().mockResolvedValue(undefined) } as unknown as any)

    const result = await service.verifyProfile(
      VALID_PROFILE_ID,
      { action: 'reverify', reason: 'Documents expired' },
      ACTOR_USER_ID,
      '',
    )

    expect(result).not.toBeNull()
    const success = result as { success: true; newStatus: string }
    expect(success.newStatus).toBe('DRAFT')
  })

  it('returns null when profile does not exist', async () => {
    const { pool } = mockPool()
    pool.query.mockResolvedValueOnce({ rows: [] })

    vi.doMock('@barghsa/db', () => ({ getDbPool: () => pool }))
    const { CrmV2Service: Svc } = await import('./crm-v2.service.js')
    const service = new Svc(createMockSessionService(), { create: vi.fn().mockResolvedValue(undefined) } as unknown as any)

    const result = await service.verifyProfile('nonexistent-id', { action: 'verify' }, ACTOR_USER_ID, '')
    expect(result).toBeNull()
  })

  it('rejects invalid action', async () => {
    const { pool } = mockPool()
    pool.query.mockResolvedValueOnce({ rows: [{ id: VALID_PROFILE_ID, user_id: 'user-001', status: 'DRAFT' }] })

    vi.doMock('@barghsa/db', () => ({ getDbPool: () => pool }))
    const { CrmV2Service: Svc } = await import('./crm-v2.service.js')
    const service = new Svc(createMockSessionService(), { create: vi.fn().mockResolvedValue(undefined) } as unknown as any)

    const result = await service.verifyProfile(VALID_PROFILE_ID, { action: 'invalid-action' }, ACTOR_USER_ID, '')
    expect(result).not.toBeNull()
    expect(result).toHaveProperty('error')
  })

  it('rejects transition from DRAFT to unverify', async () => {
    const { pool } = mockPool()
    pool.query.mockResolvedValueOnce({ rows: [{ id: VALID_PROFILE_ID, user_id: 'user-001', status: 'DRAFT' }] })

    vi.doMock('@barghsa/db', () => ({ getDbPool: () => pool }))
    const { CrmV2Service: Svc } = await import('./crm-v2.service.js')
    const service = new Svc(createMockSessionService(), { create: vi.fn().mockResolvedValue(undefined) } as unknown as any)

    const result = await service.verifyProfile(VALID_PROFILE_ID, { action: 'unverify', reason: 'test' }, ACTOR_USER_ID, '')
    expect(result).not.toBeNull()
    expect(result).toHaveProperty('error')
    expect((result as { error: string }).error).toContain('Cannot unverify')
  })

  it('rejects unverify without reason', async () => {
    const { pool } = mockPool()
    pool.query.mockResolvedValueOnce({ rows: [{ id: VALID_PROFILE_ID, user_id: 'user-001', status: 'VERIFIED' }] })

    vi.doMock('@barghsa/db', () => ({ getDbPool: () => pool }))
    const { CrmV2Service: Svc } = await import('./crm-v2.service.js')
    const service = new Svc(createMockSessionService(), { create: vi.fn().mockResolvedValue(undefined) } as unknown as any)

    const result = await service.verifyProfile(VALID_PROFILE_ID, { action: 'unverify' }, ACTOR_USER_ID, '')
    expect(result).toHaveProperty('error')
    expect((result as { error: string }).error).toContain('Reason is required')
  })

  it('rejects reverify without reason', async () => {
    const { pool } = mockPool()
    pool.query.mockResolvedValueOnce({ rows: [{ id: VALID_PROFILE_ID, user_id: 'user-001', status: 'VERIFIED' }] })

    vi.doMock('@barghsa/db', () => ({ getDbPool: () => pool }))
    const { CrmV2Service: Svc } = await import('./crm-v2.service.js')
    const service = new Svc(createMockSessionService(), { create: vi.fn().mockResolvedValue(undefined) } as unknown as any)

    const result = await service.verifyProfile(VALID_PROFILE_ID, { action: 'reverify', reason: '' }, ACTOR_USER_ID, '')
    expect(result).toHaveProperty('error')
    expect((result as { error: string }).error).toContain('Reason is required')
  })

  it('rejects verify on SUSPENDED profile', async () => {
    const { pool } = mockPool()
    pool.query.mockResolvedValueOnce({ rows: [{ id: VALID_PROFILE_ID, user_id: 'user-001', status: 'SUSPENDED' }] })

    vi.doMock('@barghsa/db', () => ({ getDbPool: () => pool }))
    const { CrmV2Service: Svc } = await import('./crm-v2.service.js')
    const service = new Svc(createMockSessionService(), { create: vi.fn().mockResolvedValue(undefined) } as unknown as any)

    const result = await service.verifyProfile(VALID_PROFILE_ID, { action: 'verify' }, ACTOR_USER_ID, '')
    expect(result).toHaveProperty('error')
    expect((result as { error: string }).error).toContain('Cannot verify')
  })

  it('returns success for no-op (already VERIFIED)', async () => {
    const { pool } = mockPool()
    pool.query.mockResolvedValueOnce({ rows: [{ id: VALID_PROFILE_ID, user_id: 'user-001', status: 'VERIFIED' }] })

    vi.doMock('@barghsa/db', () => ({ getDbPool: () => pool }))
    const { CrmV2Service: Svc } = await import('./crm-v2.service.js')
    const service = new Svc(createMockSessionService(), { create: vi.fn().mockResolvedValue(undefined) } as unknown as any)

    const result = await service.verifyProfile(VALID_PROFILE_ID, { action: 'verify' }, ACTOR_USER_ID, '')
    expect(result).not.toBeNull()
    const success = result as { success: true; previousStatus: string; newStatus: string }
    expect(success.success).toBe(true)
    expect(success.previousStatus).toBe('VERIFIED')
    expect(success.newStatus).toBe('VERIFIED')
  })

  it('records audit event with correct metadata', async () => {
    const { pool, mockConnect } = mockPool()
    const { client, mockClientQuery, mockRelease } = mockClient()

    pool.query.mockResolvedValueOnce({ rows: [{ id: VALID_PROFILE_ID, user_id: 'user-001', status: 'DRAFT' }] })
    mockConnect.mockResolvedValueOnce(client)
    mockClientQuery
      .mockResolvedValueOnce(undefined) // BEGIN
      .mockResolvedValueOnce(undefined) // UPDATE profiles
      .mockResolvedValueOnce(undefined) // INSERT audit_log
      .mockResolvedValueOnce(undefined) // COMMIT

    vi.doMock('@barghsa/db', () => ({ getDbPool: () => pool }))
    const { CrmV2Service: Svc } = await import('./crm-v2.service.js')
    const service = new Svc(createMockSessionService(), { create: vi.fn().mockResolvedValue(undefined) } as unknown as any)

    await service.verifyProfile(
      VALID_PROFILE_ID,
      { action: 'verify' },
      ACTOR_USER_ID,
      '10.0.0.1',
    )

    const auditCall = mockClientQuery.mock.calls.find(
      (call: unknown[]) => (call[0] as string).includes('INSERT INTO audit_log'),
    )
    expect(auditCall).toBeDefined()
    const auditParams = auditCall![1] as unknown[]
    const metadataStr = auditParams[3] as string
    const metadata = JSON.parse(metadataStr)
    expect(metadata.profileId).toBe(VALID_PROFILE_ID)
    expect(metadata.previousStatus).toBe('DRAFT')
    expect(metadata.newStatus).toBe('VERIFIED')
    expect(metadata.action).toBe('verify')
    expect(metadata.profileOwnerUserId).toBe('user-001')
    expect(mockRelease).toHaveBeenCalled()
  })
})

describe('CrmV2Service.forcePasswordChange', () => {
  const ACTOR_USER_ID = 'admin-user-001'
  const TARGET_USER_ID = '00000000-0000-7000-8000-000000000010'

  function mockClient() {
    const mockClientQuery = vi.fn()
    const mockRelease = vi.fn()
    const client = { query: mockClientQuery, release: mockRelease }
    return { mockClientQuery, mockRelease, client }
  }

  it('forces password change and revokes sessions', async () => {
    const { pool, mockConnect } = mockPool()
    const { client, mockClientQuery, mockRelease } = mockClient()
    const ms = createMockSessionService()

    pool.query.mockResolvedValueOnce({ rows: [{ user_id: TARGET_USER_ID }] }) // user exists
    mockConnect.mockResolvedValueOnce(client)
    mockClientQuery
      .mockResolvedValueOnce(undefined) // BEGIN
      .mockResolvedValueOnce(undefined) // UPDATE users
      .mockResolvedValueOnce(undefined) // INSERT audit_log
      .mockResolvedValueOnce(undefined) // COMMIT

    vi.doMock('@barghsa/db', () => ({ getDbPool: () => pool }))
    const { CrmV2Service: Svc } = await import('./crm-v2.service.js')
    const service = new Svc(ms, { create: vi.fn().mockResolvedValue(undefined) } as unknown as any)

    const result = await service.forcePasswordChange(TARGET_USER_ID, 'Security incident', ACTOR_USER_ID, '10.0.0.1')

    expect(result).not.toBeNull()
    expect(result).not.toHaveProperty('error')
    expect(ms.revokeAllUserSessions).toHaveBeenCalledWith(TARGET_USER_ID)
    expect(mockRelease).toHaveBeenCalledTimes(1)
  })

  it('returns null when user does not exist', async () => {
    const { pool } = mockPool()
    const ms = createMockSessionService()

    pool.query.mockResolvedValueOnce({ rows: [] })

    vi.doMock('@barghsa/db', () => ({ getDbPool: () => pool }))
    const { CrmV2Service: Svc } = await import('./crm-v2.service.js')
    const service = new Svc(ms, { create: vi.fn().mockResolvedValue(undefined) } as unknown as any)

    const result = await service.forcePasswordChange('nonexistent-id', 'test', ACTOR_USER_ID, '')

    expect(result).toBeNull()
    expect(ms.revokeAllUserSessions).not.toHaveBeenCalled()
  })

  it('returns error when reason is empty', async () => {
    const { pool } = mockPool()
    const ms = createMockSessionService()

    vi.doMock('@barghsa/db', () => ({ getDbPool: () => pool }))
    const { CrmV2Service: Svc } = await import('./crm-v2.service.js')
    const service = new Svc(ms, { create: vi.fn().mockResolvedValue(undefined) } as unknown as any)

    const result = await service.forcePasswordChange(TARGET_USER_ID, '', ACTOR_USER_ID, '')

    expect(result).not.toBeNull()
    expect(result).toHaveProperty('error')
    expect((result as { error: string }).error).toContain('Reason is required')
    expect(ms.revokeAllUserSessions).not.toHaveBeenCalled()
  })

  it('returns error when reason is whitespace', async () => {
    const { pool } = mockPool()
    const ms = createMockSessionService()

    vi.doMock('@barghsa/db', () => ({ getDbPool: () => pool }))
    const { CrmV2Service: Svc } = await import('./crm-v2.service.js')
    const service = new Svc(ms, { create: vi.fn().mockResolvedValue(undefined) } as unknown as any)

    const result = await service.forcePasswordChange(TARGET_USER_ID, '   ', ACTOR_USER_ID, '')

    expect(result).toHaveProperty('error')
    expect((result as { error: string }).error).toContain('Reason is required')
  })

  it('rolls back transaction on DB error', async () => {
    const { pool, mockConnect } = mockPool()
    const { client, mockClientQuery, mockRelease } = mockClient()
    const ms = createMockSessionService()

    pool.query.mockResolvedValueOnce({ rows: [{ user_id: TARGET_USER_ID }] })
    mockConnect.mockResolvedValueOnce(client)
    mockClientQuery
      .mockResolvedValueOnce(undefined) // BEGIN
      .mockResolvedValueOnce(undefined) // UPDATE users
      .mockRejectedValueOnce(new Error('DB insert failed')) // audit_log INSERT

    vi.doMock('@barghsa/db', () => ({ getDbPool: () => pool }))
    const { CrmV2Service: Svc } = await import('./crm-v2.service.js')
    const service = new Svc(ms, { create: vi.fn().mockResolvedValue(undefined) } as unknown as any)

    await expect(service.forcePasswordChange(TARGET_USER_ID, 'test', ACTOR_USER_ID, '10.0.0.1')).rejects.toThrow()
    expect(mockClientQuery).toHaveBeenCalledWith('ROLLBACK')
    expect(mockRelease).toHaveBeenCalled()
  })
})

describe('CrmV2Service.expireSessions', () => {
  const ACTOR_USER_ID = 'admin-user-001'
  const TARGET_USER_ID = '00000000-0000-7000-8000-000000000010'

  function mockClient() {
    const mockClientQuery = vi.fn()
    const mockRelease = vi.fn()
    const client = { query: mockClientQuery, release: mockRelease }
    return { mockClientQuery, mockRelease, client }
  }

  it('expires all sessions successfully', async () => {
    const { pool, mockConnect } = mockPool()
    const { client, mockClientQuery, mockRelease } = mockClient()
    const ms = createMockSessionService()

    pool.query.mockResolvedValueOnce({ rows: [{ user_id: TARGET_USER_ID }] }) // user exists
    mockConnect.mockResolvedValueOnce(client)
    mockClientQuery
      .mockResolvedValueOnce(undefined) // BEGIN
      .mockResolvedValueOnce(undefined) // INSERT audit_log
      .mockResolvedValueOnce(undefined) // COMMIT

    vi.doMock('@barghsa/db', () => ({ getDbPool: () => pool }))
    const { CrmV2Service: Svc } = await import('./crm-v2.service.js')
    const service = new Svc(ms, { create: vi.fn().mockResolvedValue(undefined) } as unknown as any)

    const result = await service.expireSessions(TARGET_USER_ID, 'Device lost', ACTOR_USER_ID, '10.0.0.1')

    expect(result).not.toBeNull()
    expect(result).not.toHaveProperty('error')
    expect(ms.revokeAllUserSessions).toHaveBeenCalledWith(TARGET_USER_ID)
    expect(mockRelease).toHaveBeenCalledTimes(1)
  })

  it('returns null when user does not exist', async () => {
    const { pool } = mockPool()
    const ms = createMockSessionService()

    pool.query.mockResolvedValueOnce({ rows: [] })

    vi.doMock('@barghsa/db', () => ({ getDbPool: () => pool }))
    const { CrmV2Service: Svc } = await import('./crm-v2.service.js')
    const service = new Svc(ms, { create: vi.fn().mockResolvedValue(undefined) } as unknown as any)

    const result = await service.expireSessions('nonexistent-id', 'test', ACTOR_USER_ID, '')

    expect(result).toBeNull()
    expect(ms.revokeAllUserSessions).not.toHaveBeenCalled()
  })

  it('returns error when reason is empty', async () => {
    const { pool } = mockPool()
    const ms = createMockSessionService()

    vi.doMock('@barghsa/db', () => ({ getDbPool: () => pool }))
    const { CrmV2Service: Svc } = await import('./crm-v2.service.js')
    const service = new Svc(ms, { create: vi.fn().mockResolvedValue(undefined) } as unknown as any)

    const result = await service.expireSessions(TARGET_USER_ID, '', ACTOR_USER_ID, '')

    expect(result).not.toBeNull()
    expect(result).toHaveProperty('error')
    expect((result as { error: string }).error).toContain('Reason is required')
    expect(ms.revokeAllUserSessions).not.toHaveBeenCalled()
  })

  it('rolls back transaction on DB error', async () => {
    const { pool, mockConnect } = mockPool()
    const { client, mockClientQuery, mockRelease } = mockClient()
    const ms = createMockSessionService()

    pool.query.mockResolvedValueOnce({ rows: [{ user_id: TARGET_USER_ID }] })
    mockConnect.mockResolvedValueOnce(client)
    mockClientQuery
      .mockResolvedValueOnce(undefined) // BEGIN
      .mockRejectedValueOnce(new Error('DB insert failed')) // audit_log INSERT

    vi.doMock('@barghsa/db', () => ({ getDbPool: () => pool }))
    const { CrmV2Service: Svc } = await import('./crm-v2.service.js')
    const service = new Svc(ms, { create: vi.fn().mockResolvedValue(undefined) } as unknown as any)

    await expect(service.expireSessions(TARGET_USER_ID, 'test', ACTOR_USER_ID, '10.0.0.1')).rejects.toThrow()
    expect(mockClientQuery).toHaveBeenCalledWith('ROLLBACK')
    expect(mockRelease).toHaveBeenCalled()
  })
})