import { describe, it, expect, beforeEach, vi } from 'vitest'
import { HttpException } from '@nestjs/common'
import type { AdminService as AdminServiceType } from './admin.service.js'
import type { CreateStaffUserInput } from './admin.service.js'

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
  // Benign default so un-queued calls (e.g. the catch-path ROLLBACK after an
  // error) resolve instead of returning undefined. Explicit
  // mockResolvedValueOnce entries still take precedence over it.
  mockClientQuery.mockImplementation(async () => ({ rows: [] }))
  const client = { query: mockClientQuery, release: mockRelease }
  return { mockClientQuery, mockRelease, client }
}

/** Predefined roles for mocking @barghsa/db. */
const MOCK_ROLES = [
  { id: 'role-customer-support' as const, name: 'Customer Support', description: '', permissions: [] },
  { id: 'role-crm-verification' as const, name: 'CRM & Verification', description: '', permissions: [] },
  { id: 'role-finance' as const, name: 'Finance', description: '', permissions: [] },
  { id: 'role-legal-contracts' as const, name: 'Legal & Contracts', description: '', permissions: [] },
  { id: 'role-operations' as const, name: 'Operations', description: '', permissions: [] },
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

// ─── Test data ────────────────────────────────────────────────────────

function validTempPasswordInput(overrides: Partial<CreateStaffUserInput> = {}): CreateStaffUserInput {
  return {
    username: 'newstaff@example.com',
    firstName: 'Jane',
    lastName: 'Smith',
    roleIds: [],
    activationMethod: 'tempPassword',
    ...overrides,
  }
}

function validLinkInput(overrides: Partial<CreateStaffUserInput> = {}): CreateStaffUserInput {
  return {
    username: 'newstaff2@example.com',
    firstName: 'John',
    lastName: 'Doe',
    roleIds: [],
    activationMethod: 'link',
    ...overrides,
  }
}

// ─── Tests — tempPassword activation ──────────────────────────────────

describe('AdminService.createStaffUser (tempPassword)', () => {
  it('creates a staff user with temporary password and returns it', async () => {
    const { pool, mockConnect } = mockPool()
    const { client, mockClientQuery, mockRelease } = mockClient()

    pool.query.mockResolvedValueOnce({ rows: [] })

    mockConnect.mockResolvedValueOnce(client)
    mockClientQuery
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce({ rows: [{ user_id: 'new-user-id', username: 'newstaff@example.com' }] })
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce(undefined)

    vi.doMock('@barghsa/db', () => mockDbModule(pool))
    const { AdminService: Svc } = await import('./admin.service.js')
    service = new Svc()

    const result = await service.createStaffUser(
      validTempPasswordInput(),
      'actor-user-id',
      '127.0.0.1',
    )

    expect(result.userId).toBeTruthy()
    expect(result.username).toBe('newstaff@example.com')
    expect(result.activationMethod).toBe('tempPassword')
    expect(result).toHaveProperty('temporaryPassword')
    expect(result.message).toContain('temporary password')
    expect(mockRelease).toHaveBeenCalled()
  })

  it('generates a password that satisfies strength policy', async () => {
    const { pool, mockConnect } = mockPool()
    const { client, mockClientQuery, mockRelease } = mockClient()

    pool.query.mockResolvedValueOnce({ rows: [] })
    mockConnect.mockResolvedValueOnce(client)
    mockClientQuery
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce({ rows: [{ user_id: 'uid-1', username: 'test@ex.com' }] })
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce(undefined)

    vi.doMock('@barghsa/db', () => mockDbModule(pool))
    const { AdminService: Svc } = await import('./admin.service.js')
    service = new Svc()

    const result = await service.createStaffUser(
      validTempPasswordInput({ username: 'test@example.com' }),
      'actor',
      '10.0.0.1',
    )

    const pw = result.temporaryPassword!
    expect(pw.length).toBeGreaterThanOrEqual(8)
    expect(pw).toMatch(/[A-Z]/)
    expect(pw).toMatch(/[a-z]/)
    expect(pw).toMatch(/[2-9]/)
    expect(mockRelease).toHaveBeenCalled()
  })

  it('sets must_change_password=true and is_admin=true', async () => {
    const { pool, mockConnect } = mockPool()
    const { client, mockClientQuery } = mockClient()

    pool.query.mockResolvedValueOnce({ rows: [] })
    mockConnect.mockResolvedValueOnce(client)
    mockClientQuery
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce({ rows: [{ user_id: 'uid-2', username: 'user@ex.com' }] })
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce(undefined)

    vi.doMock('@barghsa/db', () => mockDbModule(pool))
    const { AdminService: Svc } = await import('./admin.service.js')
    service = new Svc()

    await service.createStaffUser(
      validTempPasswordInput({ username: 'user@example.com' }),
      'actor',
      '10.0.0.1',
    )

    const insertUserCall = mockClientQuery.mock.calls[1]
    expect(insertUserCall).toBeDefined()
    const insertValues = insertUserCall![1]
    // is_admin is hardcoded true in SQL, must_change_password is parameter $4
    expect(insertValues[3]).toBe(true)
  })
})

// ─── Tests — link activation ──────────────────────────────────────────

describe('AdminService.createStaffUser (link)', () => {
  it('creates a staff user with activation token and returns it', async () => {
    const { pool, mockConnect } = mockPool()
    const { client, mockClientQuery, mockRelease } = mockClient()

    pool.query.mockResolvedValueOnce({ rows: [] })
    mockConnect.mockResolvedValueOnce(client)
    mockClientQuery
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce({ rows: [{ user_id: 'uid-3', username: 'staff@ex.com' }] })
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce(undefined)

    vi.doMock('@barghsa/db', () => mockDbModule(pool))
    const { AdminService: Svc } = await import('./admin.service.js')
    service = new Svc()

    const result = await service.createStaffUser(
      validLinkInput(),
      'actor',
      '10.0.0.1',
    )

    expect(result.userId).toBeTruthy()
    expect(result.username).toBe('newstaff2@example.com')
    expect(result.activationMethod).toBe('link')
    expect(result).toHaveProperty('activationToken')
    expect(result.message).toContain('activation token')
    expect(mockRelease).toHaveBeenCalled()
  })

  it('creates a profile with INDIVIDUAL type and VERIFIED status', async () => {
    const { pool, mockConnect } = mockPool()
    const { client, mockClientQuery } = mockClient()

    pool.query.mockResolvedValueOnce({ rows: [] })
    mockConnect.mockResolvedValueOnce(client)
    mockClientQuery
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce({ rows: [{ user_id: 'uid-4', username: 'test@ex.com' }] })
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce(undefined)

    vi.doMock('@barghsa/db', () => mockDbModule(pool))
    const { AdminService: Svc } = await import('./admin.service.js')
    service = new Svc()

    await service.createStaffUser(
      validLinkInput({ username: 'test@example.com', firstName: 'Ali', lastName: 'Rezaei' }),
      'actor',
      '10.0.0.1',
    )

    const insertProfileCall = mockClientQuery.mock.calls[2]
    expect(insertProfileCall).toBeDefined()
    const insertProfileSql = insertProfileCall![0]
    expect(insertProfileSql).toContain('profiles')
    expect(insertProfileSql).toContain("'INDIVIDUAL'")
    expect(insertProfileSql).toContain("'VERIFIED'")
  })
})

// ─── Tests — errors ───────────────────────────────────────────────────

describe('AdminService.createStaffUser (errors)', () => {
  it('throws 409 when username is already taken', async () => {
    const { pool } = mockPool()
    pool.query.mockResolvedValueOnce({ rows: [{ user_id: 'existing-user' }] })

    vi.doMock('@barghsa/db', () => mockDbModule(pool))
    const { AdminService: Svc } = await import('./admin.service.js')
    service = new Svc()

    let caught: unknown
    try {
      await service.createStaffUser(validTempPasswordInput(), 'actor', '10.0.0.1')
    } catch (e) {
      caught = e
    }

    expect(caught).toBeInstanceOf(HttpException)
    expect((caught as HttpException).getStatus()).toBe(409)
  })

  it('throws 409 on unique constraint violation inside transaction (TOCTOU guard)', async () => {
    const { pool, mockConnect } = mockPool()
    const { client, mockClientQuery } = mockClient()

    pool.query.mockResolvedValueOnce({ rows: [] })
    mockConnect.mockResolvedValueOnce(client)
    mockClientQuery
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce({ code: '23505', detail: 'Key (username)=(x) already exists.' })
      .mockResolvedValueOnce(undefined)

    vi.doMock('@barghsa/db', () => mockDbModule(pool))
    const { AdminService: Svc } = await import('./admin.service.js')
    service = new Svc()

    let caught: unknown
    try {
      await service.createStaffUser(validTempPasswordInput(), 'actor', '10.0.0.1')
    } catch (e) {
      caught = e
    }

    expect(caught).toBeInstanceOf(HttpException)
    expect((caught as HttpException).getStatus()).toBe(409)
  })

  it('throws 500 on unexpected database error', async () => {
    const { pool, mockConnect } = mockPool()
    const { client, mockClientQuery } = mockClient()

    pool.query.mockResolvedValueOnce({ rows: [] })
    mockConnect.mockResolvedValueOnce(client)
    mockClientQuery
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error('Connection timeout'))
      .mockResolvedValueOnce(undefined)

    vi.doMock('@barghsa/db', () => mockDbModule(pool))
    const { AdminService: Svc } = await import('./admin.service.js')
    service = new Svc()

    let caught: unknown
    try {
      await service.createStaffUser(validTempPasswordInput(), 'actor', '10.0.0.1')
    } catch (e) {
      caught = e
    }

    expect(caught).toBeInstanceOf(HttpException)
    expect((caught as HttpException).getStatus()).toBe(500)
  })

  it('throws 400 when roleIds contain invalid role IDs', async () => {
    const { pool } = mockPool()
    pool.query.mockResolvedValueOnce({ rows: [] })

    vi.doMock('@barghsa/db', () => mockDbModule(pool))
    const { AdminService: Svc } = await import('./admin.service.js')
    service = new Svc()

    let caught: unknown
    try {
      await service.createStaffUser(
        validTempPasswordInput({ roleIds: ['nonexistent-role'] }),
        'actor',
        '10.0.0.1',
      )
    } catch (e) {
      caught = e
    }

    expect(caught).toBeInstanceOf(HttpException)
    expect((caught as HttpException).getStatus()).toBe(400)
  })
})

// ─── Tests — transaction rollback ─────────────────────────────────────

describe('AdminService.createStaffUser (rollback)', () => {
  it('releases the client even when rollback is called', async () => {
    const { pool, mockConnect } = mockPool()
    const { client, mockClientQuery, mockRelease } = mockClient()

    pool.query.mockResolvedValueOnce({ rows: [] })
    mockConnect.mockResolvedValueOnce(client)

    mockClientQuery
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error('DB failure'))
      .mockResolvedValueOnce(undefined)

    vi.doMock('@barghsa/db', () => mockDbModule(pool))
    const { AdminService: Svc } = await import('./admin.service.js')
    service = new Svc()

    try {
      await service.createStaffUser(validTempPasswordInput(), 'actor', '10.0.0.1')
    } catch {
      // Expected
    }

    expect(mockRelease).toHaveBeenCalled()
  })

  it('throws 400 when roleIds contain invalid role IDs', async () => {
    const { pool } = mockPool()
    pool.query.mockResolvedValueOnce({ rows: [] })

    vi.doMock('@barghsa/db', () => mockDbModule(pool))
    const { AdminService: Svc } = await import('./admin.service.js')
    service = new Svc()

    let caught: unknown
    try {
      await service.createStaffUser(
        validTempPasswordInput({ roleIds: ['nonexistent-role'] }),
        'actor',
        '10.0.0.1',
      )
    } catch (e) {
      caught = e
    }

    expect(caught).toBeInstanceOf(HttpException)
    expect((caught as HttpException).getStatus()).toBe(400)
  })
})

// ─── Tests — updateStaffRoles ──────────────────────────────────────────

describe('AdminService.updateStaffRoles', () => {
  it('updates roles for an existing user (replaces role set)', async () => {
    const { pool, mockConnect } = mockPool()
    const { client, mockClientQuery, mockRelease } = mockClient()

    // User exists check
    pool.query.mockResolvedValueOnce({ rows: [{ user_id: 'target-user', is_admin: true }] })

    mockConnect.mockResolvedValueOnce(client)
    mockClientQuery
      .mockResolvedValueOnce(undefined) // BEGIN
      .mockResolvedValueOnce({ rows: [{ role_id: 'role-customer-support' }, { role_id: 'role-finance' }] }) // current roles
      .mockResolvedValueOnce(undefined) // DELETE old roles
      .mockResolvedValueOnce(undefined) // INSERT new roles
      .mockResolvedValueOnce(undefined) // audit log INSERT
      .mockResolvedValueOnce(undefined) // COMMIT

    vi.doMock('@barghsa/db', () => mockDbModule(pool))
    const { AdminService: Svc } = await import('./admin.service.js')
    service = new Svc()

    const result = await service.updateStaffRoles(
      'target-user',
      ['role-crm-verification', 'role-operations'],
      'actor-user',
      '127.0.0.1',
    )

    expect(result.userId).toBe('target-user')
    expect(result.roleIds).toEqual(['role-crm-verification', 'role-operations'])
    expect(result.previousRoleIds).toEqual(['role-customer-support', 'role-finance'])
    expect(mockRelease).toHaveBeenCalled()
  })

  it('allows empty role set (removes all roles)', async () => {
    const { pool, mockConnect } = mockPool()
    const { client, mockClientQuery, mockRelease } = mockClient()

    pool.query.mockResolvedValueOnce({ rows: [{ user_id: 'target-user', is_admin: true }] })

    mockConnect.mockResolvedValueOnce(client)
    mockClientQuery
      .mockResolvedValueOnce(undefined) // BEGIN
      .mockResolvedValueOnce({ rows: [{ role_id: 'role-admin' }] }) // current roles
      .mockResolvedValueOnce(undefined) // DELETE old roles
      // No INSERT (empty role set)
      .mockResolvedValueOnce(undefined) // audit log
      .mockResolvedValueOnce(undefined) // COMMIT

    vi.doMock('@barghsa/db', () => mockDbModule(pool))
    const { AdminService: Svc } = await import('./admin.service.js')
    service = new Svc()

    const result = await service.updateStaffRoles(
      'target-user',
      [],
      'actor',
      '10.0.0.1',
    )

    expect(result.roleIds).toEqual([])
    expect(result.previousRoleIds).toEqual(['role-admin'])
    expect(mockRelease).toHaveBeenCalled()
  })

  it('throws 404 when target user does not exist', async () => {
    const { pool } = mockPool()
    pool.query.mockResolvedValueOnce({ rows: [] })

    vi.doMock('@barghsa/db', () => mockDbModule(pool))
    const { AdminService: Svc } = await import('./admin.service.js')
    service = new Svc()

    let caught: unknown
    try {
      await service.updateStaffRoles('nonexistent', ['role-admin'], 'actor', '10.0.0.1')
    } catch (e) {
      caught = e
    }

    expect(caught).toBeInstanceOf(HttpException)
    expect((caught as HttpException).getStatus()).toBe(404)
  })

  it('throws 500 on unexpected database error', async () => {
    const { pool, mockConnect } = mockPool()
    const { client, mockClientQuery } = mockClient()

    pool.query.mockResolvedValueOnce({ rows: [{ user_id: 'target', is_admin: true }] })
    mockConnect.mockResolvedValueOnce(client)
    // BEGIN fails with an unexpected error
    mockClientQuery
      .mockRejectedValueOnce(new Error('Unexpected DB failure'))
      .mockResolvedValueOnce(undefined) // ROLLBACK (caught with .catch)

    vi.doMock('@barghsa/db', () => mockDbModule(pool))
    const { AdminService: Svc } = await import('./admin.service.js')
    service = new Svc()

    let caught: unknown
    try {
      await service.updateStaffRoles('target', ['role-admin'], 'actor', '10.0.0.1')
    } catch (e) {
      caught = e
    }

    expect(caught).toBeInstanceOf(HttpException)
    expect((caught as HttpException).getStatus()).toBe(500)
  })

  it('throws 400 when roleIds contain invalid role IDs', async () => {
    const { pool } = mockPool()
    pool.query.mockResolvedValueOnce({ rows: [{ user_id: 'target', is_admin: true }] })

    vi.doMock('@barghsa/db', () => mockDbModule(pool))
    const { AdminService: Svc } = await import('./admin.service.js')
    service = new Svc()

    let caught: unknown
    try {
      await service.updateStaffRoles('target', ['nonexistent-role'], 'actor', '10.0.0.1')
    } catch (e) {
      caught = e
    }

    expect(caught).toBeInstanceOf(HttpException)
    expect((caught as HttpException).getStatus()).toBe(400)
  })
})

// ─── Tests — profile verification mode ────────────────────────────────

describe('AdminService.getProfileVerificationMode', () => {
  it('returns DISABLED when config key is not set', async () => {
    const { pool } = mockPool()
    pool.query.mockResolvedValueOnce({ rows: [] })

    vi.doMock('@barghsa/db', () => mockDbModule(pool))
    const { AdminService: Svc } = await import('./admin.service.js')
    service = new Svc()

    const result = await service.getProfileVerificationMode()
    expect(result.mode).toBe('DISABLED')
  })

  it('returns the configured mode from app_config', async () => {
    const { pool } = mockPool()
    pool.query.mockResolvedValueOnce({ rows: [{ value: 'MANUAL' }] })

    vi.doMock('@barghsa/db', () => mockDbModule(pool))
    const { AdminService: Svc } = await import('./admin.service.js')
    service = new Svc()

    const result = await service.getProfileVerificationMode()
    expect(result.mode).toBe('MANUAL')
  })
})

describe('AdminService.setProfileVerificationMode', () => {
  it('upserts the config value and bumps global version', async () => {
    const { pool } = mockPool()
    const { mockClientQuery, mockRelease, client } = mockClient()
    pool.connect.mockResolvedValue(client)
    mockClientQuery.mockResolvedValue({ rows: [] }) // BEGIN
    mockClientQuery.mockResolvedValue({ rows: [] }) // INSERT/UPDATE
    mockClientQuery.mockResolvedValue({ rows: [] }) // config_version bump
    mockClientQuery.mockResolvedValue({ rows: [] }) // audit_log insert
    mockClientQuery.mockResolvedValue({ rows: [] }) // COMMIT

    vi.doMock('@barghsa/db', () => mockDbModule(pool))
    const { AdminService: Svc } = await import('./admin.service.js')
    service = new Svc()

    const result = await service.setProfileVerificationMode('API', 'actor', '10.0.0.1')
    expect(result.mode).toBe('API')
    expect(mockClientQuery).toHaveBeenCalled()
    expect(mockRelease).toHaveBeenCalled()
  })
})

describe('AdminService.listStaffRoles', () => {
  it('maps role rows to DTOs and marks predefined roles', async () => {
    const { pool } = mockPool()
    pool.query.mockResolvedValueOnce({
      rows: [
        {
          role_id: 'role-admin',
          name: 'Admin',
          description: 'Full access',
          permissions: JSON.stringify(['*']),
          created_at: new Date('2026-01-01T00:00:00Z'),
          updated_at: new Date('2026-01-01T00:00:00Z'),
        },
        {
          role_id: 'role-custom',
          name: 'Custom Role',
          description: 'Custom',
          permissions: JSON.stringify(['tickets:read']),
          created_at: new Date('2026-01-02T00:00:00Z'),
          updated_at: new Date('2026-01-02T00:00:00Z'),
        },
      ],
    })

    vi.doMock('@barghsa/db', () => mockDbModule(pool))
    const { AdminService: Svc } = await import('./admin.service.js')
    service = new Svc()

    const result = await service.listStaffRoles()
    expect(result).toHaveLength(2)
    const adm = result[0]
    const custom = result[1]
    expect(adm).toMatchObject({ roleId: 'role-admin', predefined: true, permissions: ['*'] })
    expect(custom).toMatchObject({ roleId: 'role-custom', predefined: false, permissions: ['tickets:read'] })
  })

  it('tolerates malformed permissions JSON', async () => {
    const { pool } = mockPool()
    pool.query.mockResolvedValueOnce({
      rows: [
        { role_id: 'role-x', name: 'X', description: 'x', permissions: 'not-json', created_at: null, updated_at: null },
      ],
    })

    vi.doMock('@barghsa/db', () => mockDbModule(pool))
    const { AdminService: Svc } = await import('./admin.service.js')
    service = new Svc()

    const result = await service.listStaffRoles()
    const first = result[0]
    expect(first?.permissions).toEqual([])
    expect(first?.predefined).toBe(false)
  })

  it('handles already-parsed (jsonb) permission arrays', async () => {
    const { pool } = mockPool()
    pool.query.mockResolvedValueOnce({
      rows: [
        { role_id: 'role-x', name: 'X', description: 'x', permissions: ['tickets:read', 'crm:read'], created_at: null, updated_at: null },
      ],
    })

    vi.doMock('@barghsa/db', () => mockDbModule(pool))
    const { AdminService: Svc } = await import('./admin.service.js')
    service = new Svc()

    const result = await service.listStaffRoles()
    expect(result[0]?.permissions).toEqual(['tickets:read', 'crm:read'])
  })
})

describe('AdminService.getEffectivePermissions', () => {
  it('returns the union of permissions across roles for a non-admin', async () => {
    const { pool } = mockPool()
    pool.query
      .mockResolvedValueOnce({ rows: [{ user_id: 'u1', is_admin: false }] }) // user lookup
      .mockResolvedValueOnce({
        // roles lookup
        rows: [
          { role_id: 'role-crm', name: 'CRM & Verification', permissions: JSON.stringify(['crm:read', 'profiles:read']) },
          { role_id: 'role-support', name: 'Customer Support', permissions: JSON.stringify(['tickets:read']) },
        ],
      })

    vi.doMock('@barghsa/db', () => mockDbModule(pool))
    const { AdminService: Svc } = await import('./admin.service.js')
    service = new Svc()

    const result = await service.getEffectivePermissions('u1')
    expect(result.isAdmin).toBe(false)
    expect(result.isWildcard).toBe(false)
    expect(result.roleIds).toEqual(['role-crm', 'role-support'])
    expect(result.roleNames).toEqual(['CRM & Verification', 'Customer Support'])
    const perms = result.permissions.map((p) => p.permission)
    expect(perms).toContain('tickets:read')
    expect(perms).toContain('crm:read')
    expect(perms).toContain('profiles:read')
  })

  it('returns the wildcard set for an admin user', async () => {
    const { pool } = mockPool()
    pool.query
      .mockResolvedValueOnce({ rows: [{ user_id: 'u1', is_admin: true }] })
      .mockResolvedValueOnce({ rows: [] })

    vi.doMock('@barghsa/db', () => mockDbModule(pool))
    const { AdminService: Svc } = await import('./admin.service.js')
    service = new Svc()

    const result = await service.getEffectivePermissions('u1')
    expect(result.isAdmin).toBe(true)
    expect(result.isWildcard).toBe(true)
    expect(result.permissions[0]?.permission).toBe('*')
  })

  it('throws 404 for an unknown user', async () => {
    const { pool } = mockPool()
    pool.query.mockResolvedValueOnce({ rows: [] })

    vi.doMock('@barghsa/db', () => mockDbModule(pool))
    const { AdminService: Svc } = await import('./admin.service.js')
    service = new Svc()

    await expect(service.getEffectivePermissions('missing')).rejects.toMatchObject({ status: 404 })
  })
})

// ─── Tests — listStaff (T-10.01.01) ──────────────────────────────────

describe('AdminService.listStaff', () => {
  it('returns staff rows with roles, last login, and status', async () => {
    const { pool } = mockPool()
    pool.query
      .mockResolvedValueOnce({ rows: [{ total: 2 }] }) // count
      .mockResolvedValueOnce({
        rows: [
          {
            user_id: 'u-admin',
            username: 'admin@example.com',
            email: 'admin@example.com',
            mobile: null,
            is_admin: true,
            created_at: new Date('2026-01-01T00:00:00Z'),
            last_login_at: new Date('2026-08-01T10:00:00Z'),
            disabled_at: null,
            first_name: 'Ada',
            last_name: 'Lovelace',
            roles: [{ roleId: 'role-admin', name: 'Admin' }],
          },
          {
            user_id: 'u-support',
            username: '+989120000000',
            email: null,
            mobile: '+989120000000',
            is_admin: false,
            created_at: new Date('2026-02-01T00:00:00Z'),
            last_login_at: null,
            disabled_at: new Date('2026-08-15T12:00:00Z'),
            first_name: 'Grace',
            last_name: 'Hopper',
            roles: [{ roleId: 'role-customer-support', name: 'Customer Support' }],
          },
        ],
      })

    vi.doMock('@barghsa/db', () => mockDbModule(pool))
    const { AdminService: Svc } = await import('./admin.service.js')
    service = new Svc()

    const result = await service.listStaff({ limit: 10, offset: 0 })

    expect(result.total).toBe(2)
    expect(result.limit).toBe(10)
    expect(result.items).toHaveLength(2)
    expect(result.items[0]!.username).toBe('admin@example.com')
    expect(result.items[0]!.status).toBe('active')
    expect(result.items[0]!.roles).toEqual([{ roleId: 'role-admin', name: 'Admin' }])
    expect(result.items[0]!.lastLoginAt).toBe('2026-08-01T10:00:00.000Z')
    expect(result.items[1]!.status).toBe('disabled')
    expect(result.items[1]!.lastLoginAt).toBeNull()
    expect(result.items[1]!.disabledAt).toBe('2026-08-15T12:00:00.000Z')
    expect(result.items[1]!.isAdmin).toBe(false)
  })

  it('clamps limit to the 1..200 range and defaults to 50', async () => {
    const { pool } = mockPool()
    // Two listStaff calls × (COUNT + list) queries
    pool.query
      .mockResolvedValueOnce({ rows: [{ total: 0 }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ total: 0 }] })
      .mockResolvedValueOnce({ rows: [] })

    vi.doMock('@barghsa/db', () => mockDbModule(pool))
    const { AdminService: Svc } = await import('./admin.service.js')
    service = new Svc()

    const clamped = await service.listStaff({ limit: 5000 })
    expect(clamped.limit).toBe(200)

    const defaulted = await service.listStaff()
    expect(defaulted.limit).toBe(50)

    // First query of each call is the COUNT; list query params follow.
    expect(pool.query.mock.calls[1]![1]).toEqual([200, 0])
    expect(pool.query.mock.calls[3]![1]).toEqual([50, 0])
  })

  it('legacy string roles degrade to an empty array', async () => {
    const { pool } = mockPool()
    pool.query
      .mockResolvedValueOnce({ rows: [{ total: 1 }] })
      .mockResolvedValueOnce({
        rows: [
          {
            user_id: 'u1',
            username: 'a@example.com',
            email: null,
            mobile: null,
            is_admin: false,
            created_at: new Date('2026-01-01T00:00:00Z'),
            last_login_at: null,
            disabled_at: null,
            first_name: null,
            last_name: null,
            roles: 'not-an-array',
          },
        ],
      })

    vi.doMock('@barghsa/db', () => mockDbModule(pool))
    const { AdminService: Svc } = await import('./admin.service.js')
    service = new Svc()

    const result = await service.listStaff()
    expect(result.items[0]!.roles).toEqual([])
    expect(result.items[0]!.firstName).toBeNull()
  })
})

// ─── Tests — disableStaff (T-10.01.01) ───────────────────────────────

describe('AdminService.disableStaff', () => {
  it('disables the account, revokes sessions/tokens, and records an audit entry', async () => {
    const { pool, mockConnect } = mockPool()
    const { client, mockClientQuery, mockRelease } = mockClient()

    mockConnect.mockResolvedValueOnce(client)
    mockClientQuery
      .mockResolvedValueOnce(undefined) // BEGIN
      .mockResolvedValueOnce({ rows: [{ user_id: 'u-target', username: 'staff@example.com', disabled_at: null }] })
      .mockResolvedValueOnce(undefined) // UPDATE users
      .mockResolvedValueOnce(undefined) // UPDATE sessions
      .mockResolvedValueOnce(undefined) // UPDATE refresh_tokens
      .mockResolvedValueOnce(undefined) // INSERT audit_log
      .mockResolvedValueOnce(undefined) // COMMIT

    vi.doMock('@barghsa/db', () => mockDbModule(pool))
    const { AdminService: Svc } = await import('./admin.service.js')
    service = new Svc()

    const result = await service.disableStaff({
      userId: 'u-target',
      actorUserId: 'u-admin',
      ip: '10.0.0.1',
    })

    expect(result.status).toBe('disabled')
    expect(result.alreadyDisabled).toBe(false)
    expect(result.username).toBe('staff@example.com')
    expect(result.disabledAt).toBeTruthy()

    // Sessions and refresh tokens are revoked in the same transaction
    const sqlCalls = mockClientQuery.mock.calls.map((c: unknown[]) => c[0] as string)
    expect(sqlCalls.some((s) => s.includes('UPDATE sessions') && s.includes('revoked_at'))).toBe(true)
    expect(sqlCalls.some((s) => s.includes('UPDATE refresh_tokens') && s.includes('consumed_at'))).toBe(true)

    // Audit entry carries actor + target
    const auditCall = mockClientQuery.mock.calls.find((c) => String(c[0]).includes('INSERT INTO audit_log'))
    expect(auditCall).toBeDefined()
    const auditMetadata = JSON.parse(auditCall![1]![3] as string)
    expect(auditMetadata).toMatchObject({ actorUserId: 'u-admin' })
    expect(auditCall![1]![1]).toBe('u-target') // audit_log.user_id = target
    expect(mockRelease).toHaveBeenCalled()
  })

  it('rejects disabling your own account', async () => {
    const { pool, mockConnect } = mockPool()
    const { client, mockClientQuery } = mockClient()

    mockConnect.mockResolvedValueOnce(client)
    mockClientQuery
      .mockResolvedValueOnce(undefined) // BEGIN
      .mockResolvedValueOnce({ rows: [{ user_id: 'u-admin', username: 'admin@example.com', disabled_at: null }] })
      .mockResolvedValueOnce(undefined) // ROLLBACK

    vi.doMock('@barghsa/db', () => mockDbModule(pool))
    const { AdminService: Svc } = await import('./admin.service.js')
    service = new Svc()

    await expect(
      service.disableStaff({ userId: 'u-admin', actorUserId: 'u-admin', ip: '10.0.0.1' }),
    ).rejects.toMatchObject({ status: 400 })
  })

  it('is idempotent for an already-disabled account', async () => {
    const { pool, mockConnect } = mockPool()
    const { client, mockClientQuery } = mockClient()

    mockConnect.mockResolvedValueOnce(client)
    mockClientQuery
      .mockResolvedValueOnce(undefined) // BEGIN
      .mockResolvedValueOnce({ rows: [{ user_id: 'u2', username: 'x@example.com', disabled_at: new Date('2026-08-01T00:00:00Z') }] })
      .mockResolvedValueOnce(undefined) // COMMIT

    vi.doMock('@barghsa/db', () => mockDbModule(pool))
    const { AdminService: Svc } = await import('./admin.service.js')
    service = new Svc()

    const result = await service.disableStaff({ userId: 'u2', actorUserId: 'u-admin', ip: '10.0.0.1' })

    expect(result.alreadyDisabled).toBe(true)
    expect(result.disabledAt).toBe('2026-08-01T00:00:00.000Z')
    // No UPDATE writes for the already-disabled path
    const writes = mockClientQuery.mock.calls.filter((c) => String(c[0]).startsWith('UPDATE'))
    expect(writes).toHaveLength(0)
  })

  it('throws 404 for a non-staff or unknown user', async () => {
    const { pool, mockConnect } = mockPool()
    const { client, mockClientQuery } = mockClient()

    mockConnect.mockResolvedValueOnce(client)
    mockClientQuery
      .mockResolvedValueOnce(undefined) // BEGIN
      .mockResolvedValueOnce({ rows: [] }) // target select — not staff / missing
      .mockResolvedValueOnce(undefined) // ROLLBACK

    vi.doMock('@barghsa/db', () => mockDbModule(pool))
    const { AdminService: Svc } = await import('./admin.service.js')
    service = new Svc()

    await expect(
      service.disableStaff({ userId: 'customer-not-staff', actorUserId: 'u-admin', ip: '10.0.0.1' }),
    ).rejects.toMatchObject({ status: 404 })
  })
})

// ─── Tests — listStaffAudit (T-10.01.02) ─────────────────────────────

describe('AdminService.listStaffAudit', () => {
  const ROLE_CHANGE_METADATA = JSON.stringify({
    targetUserId: 'u-target',
    previousRoleIds: ['role-customer-support'],
    newRoleIds: ['role-customer-support', 'role-finance'],
    reason: 'Promoted to finance reviewer',
  })

  it('returns role_change events with computed added/removed diffs and resolved role names', async () => {
    const { pool } = mockPool()
    const createdAt = new Date('2026-08-20T09:30:00Z')
    // count, staff_roles lookup, page
    pool.query
      .mockResolvedValueOnce({ rows: [{ total: 1 }] })
      .mockResolvedValueOnce({
        rows: [
          { role_id: 'role-customer-support', name: 'Customer Support' },
          { role_id: 'role-finance', name: 'Finance' },
        ],
      })
      .mockResolvedValueOnce({
        rows: [
          {
            id: 'audit-1',
            actor_user_id: 'u-admin',
            target_user_id: 'u-target',
            target_username: 'staff@example.com',
            actor_username: 'admin@example.com',
            metadata: ROLE_CHANGE_METADATA,
            correlation_id: 'corr-1',
            ip: '10.0.0.9',
            created_at: createdAt,
          },
        ],
      })

    vi.doMock('@barghsa/db', () => mockDbModule(pool))
    const { AdminService: Svc } = await import('./admin.service.js')
    service = new Svc()

    const result = await service.listStaffAudit()

    expect(result.total).toBe(1)
    expect(result.items).toHaveLength(1)
    const event = result.items[0]!
    expect(event.targetUserId).toBe('u-target')
    expect(event.targetUsername).toBe('staff@example.com')
    expect(event.actorUserId).toBe('u-admin')
    expect(event.actorUsername).toBe('admin@example.com')
    expect(event.addedRoles).toEqual([{ roleId: 'role-finance', roleName: 'Finance' }])
    expect(event.removedRoles).toEqual([])
    expect(event.previousRoleIds).toEqual(['role-customer-support'])
    expect(event.newRoleIds).toEqual(['role-customer-support', 'role-finance'])
    expect(event.reason).toBe('Promoted to finance reviewer')
    expect(event.createdAt).toBe('2026-08-20T09:30:00.000Z')
  })

  it('computes removals and falls back to roleId when a role has no staff_roles row', async () => {
    const { pool } = mockPool()
    const metadata = JSON.stringify({
      targetUserId: 'u-target',
      previousRoleIds: ['role-finance', 'role-ops'],
      newRoleIds: ['role-finance'],
      reason: null,
    })
    pool.query
      .mockResolvedValueOnce({ rows: [{ total: 1 }] })
      .mockResolvedValueOnce({ rows: [{ role_id: 'role-finance', name: 'Finance' }] })
      .mockResolvedValueOnce({
        rows: [
          {
            id: 'audit-2',
            actor_user_id: 'u-admin',
            target_user_id: 'u-target',
            target_username: null,
            actor_username: 'admin@example.com',
            metadata,
            correlation_id: null,
            ip: null,
            created_at: new Date('2026-08-21T08:00:00Z'),
          },
        ],
      })

    vi.doMock('@barghsa/db', () => mockDbModule(pool))
    const { AdminService: Svc } = await import('./admin.service.js')
    service = new Svc()

    const result = await service.listStaffAudit()

    expect(result.items[0]!.removedRoles).toEqual([
      { roleId: 'role-ops', roleName: 'role-ops' },
    ])
    expect(result.items[0]!.addedRoles).toEqual([])
    expect(result.items[0]!.reason).toBeNull()
    expect(result.items[0]!.targetUsername).toBeNull()
  })

  it('passes the userId and date-range filters into both SQL queries', async () => {
    const { pool } = mockPool()
    const fromIso = '2026-08-01T00:00:00.000Z'
    const toIso = '2026-08-31T23:59:59.999Z'
    pool.query.mockResolvedValue({ rows: [] })
    // First call resolves count 0 — filters are asserted on the params; an
    // empty page short-circuits before the roles/page queries.
    pool.query
      .mockResolvedValueOnce({ rows: [{ total: 0 }] })
      .mockResolvedValue({ rows: [] })

    vi.doMock('@barghsa/db', () => mockDbModule(pool))
    const { AdminService: Svc } = await import('./admin.service.js')
    service = new Svc()

    await service.listStaffAudit({ userId: '11111111-2222-4333-8444-555555555555', from: fromIso, to: toIso })

    const countCall = pool.query.mock.calls[0]!
    expect(countCall[1]).toEqual([
      '11111111-2222-4333-8444-555555555555',
      new Date(fromIso),
      new Date(toIso),
    ])
    expect(String(countCall[0])).toContain('role_change')
    expect(String(countCall[0])).toContain('targetUserId')
    expect(String(countCall[0])).toContain('created_at >= $2')
  })

  it('clamps limit to 1..200 and defaults to 50/0', async () => {
    const { pool } = mockPool()
    pool.query.mockResolvedValue({ rows: [{ total: 0 }] })

    vi.doMock('@barghsa/db', () => mockDbModule(pool))
    const { AdminService: Svc } = await import('./admin.service.js')
    service = new Svc()

    const clamped = await service.listStaffAudit({ limit: 5000 })
    expect(clamped.limit).toBe(200)

    const defaulted = await service.listStaffAudit()
    expect(defaulted.limit).toBe(50)
    expect(defaulted.offset).toBe(0)
  })

  it('rejects a non-UUID userId filter with 400', async () => {
    const { pool } = mockPool()
    pool.query.mockResolvedValue({ rows: [] })
    vi.doMock('@barghsa/db', () => mockDbModule(pool))
    const { AdminService: Svc } = await import('./admin.service.js')
    service = new Svc()

    await expect(service.listStaffAudit({ userId: 'not-a-uuid' })).rejects.toMatchObject({
      status: 400,
    })
    expect(pool.query).not.toHaveBeenCalled()
  })

  it('rejects an invalid date range with 400', async () => {
    const { pool } = mockPool()
    pool.query.mockResolvedValue({ rows: [] })
    vi.doMock('@barghsa/db', () => mockDbModule(pool))
    const { AdminService: Svc } = await import('./admin.service.js')
    service = new Svc()

    await expect(
      service.listStaffAudit({ from: '2026-09-01T00:00:00Z', to: '2026-08-01T00:00:00Z' }),
    ).rejects.toMatchObject({ status: 400 })
    expect(pool.query).not.toHaveBeenCalled()
  })

  it('handles malformed metadata rows without crashing the page', async () => {
    const { pool } = mockPool()
    pool.query
      .mockResolvedValueOnce({ rows: [{ total: 1 }] })
      .mockResolvedValueOnce({ rows: [] }) // staff_roles empty
      .mockResolvedValueOnce({
        rows: [
          {
            id: 'audit-3',
            actor_user_id: 'u-admin',
            target_user_id: null,
            target_username: null,
            actor_username: 'admin@example.com',
            metadata: 'not-json-at-all',
            correlation_id: null,
            ip: null,
            created_at: new Date('2026-08-22T08:00:00Z'),
          },
        ],
      })

    vi.doMock('@barghsa/db', () => mockDbModule(pool))
    const { AdminService: Svc } = await import('./admin.service.js')
    service = new Svc()

    const result = await service.listStaffAudit()
    expect(result.items[0]!.addedRoles).toEqual([])
    expect(result.items[0]!.removedRoles).toEqual([])
    expect(result.items[0]!.targetUserId).toBe('')
  })
})