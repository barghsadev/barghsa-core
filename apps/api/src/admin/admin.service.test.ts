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

    vi.doMock('@barghsa/db', () => ({ getDbPool: () => pool }))
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

    vi.doMock('@barghsa/db', () => ({ getDbPool: () => pool }))
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

    vi.doMock('@barghsa/db', () => ({ getDbPool: () => pool }))
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

    vi.doMock('@barghsa/db', () => ({ getDbPool: () => pool }))
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

    vi.doMock('@barghsa/db', () => ({ getDbPool: () => pool }))
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

    vi.doMock('@barghsa/db', () => ({ getDbPool: () => pool }))
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

    vi.doMock('@barghsa/db', () => ({ getDbPool: () => pool }))
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

    vi.doMock('@barghsa/db', () => ({ getDbPool: () => pool }))
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

    vi.doMock('@barghsa/db', () => ({ getDbPool: () => pool }))
    const { AdminService: Svc } = await import('./admin.service.js')
    service = new Svc()

    try {
      await service.createStaffUser(validTempPasswordInput(), 'actor', '10.0.0.1')
    } catch {
      // Expected
    }

    expect(mockRelease).toHaveBeenCalled()
  })
})