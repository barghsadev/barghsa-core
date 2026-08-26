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