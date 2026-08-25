import { describe, it, expect, beforeEach, vi } from 'vitest'
import { CrmService, type CrmUsersResponse } from './crm.service.js'

// ─── Helpers ──────────────────────────────────────────────────────────

function mockPool() {
  const mockQuery = vi.fn()
  const pool = { query: mockQuery }
  return { mockQuery, pool }
}

function makeService(pool: ReturnType<typeof mockPool>['pool']) {
  // Mock getDbPool to return our test pool
  vi.doMock('@barghsa/db', () => ({
    getDbPool: () => pool,
  }))

  // Dynamic import so the mock is applied
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { CrmService: CrmSvc } = require('./crm.service.js')
  return new CrmSvc()
}

// We import the real CrmService after resetting modules so the
// @barghsa/db mock takes effect.  Each test file gets its own
// module registry to avoid cross-test pollution.
let service: CrmService

beforeEach(() => {
  vi.resetModules()
  vi.restoreAllMocks()
})

describe('CrmService.listUsers', () => {
  it('returns an empty list when no users exist', async () => {
    const { pool } = mockPool()
    pool.query.mockResolvedValue({ rows: [] })
    vi.doMock('@barghsa/db', () => ({ getDbPool: () => pool }))
    const { CrmService: CrmSvc } = await import('./crm.service.js')
    service = new CrmSvc()

    const result = await service.listUsers(null, 20)

    expect(result.users).toEqual([])
    expect(result.cursor).toBeNull()
    expect(result.hasMore).toBe(false)
  })

  it('returns users with correct shape', async () => {
    const { pool } = mockPool()
    const fakeRows = [
      {
        user_id: '11111111-1111-7111-8111-111111111111',
        username: 'user@example.com',
        email: 'user@example.com',
        mobile: null,
        registration_date: '2026-01-15T10:00:00Z',
        last_login: '2026-06-01T08:00:00Z',
        profile_count: 2,
        has_individual_profile: true,
        has_legal_profile: true,
        has_verified_profile: true,
      },
    ]
    // Return pageSize+1 rows to test hasMore; returning only 1 means no more pages
    pool.query.mockResolvedValue({ rows: fakeRows })
    vi.doMock('@barghsa/db', () => ({ getDbPool: () => pool }))
    const { CrmService: CrmSvc } = await import('./crm.service.js')
    service = new CrmSvc()

    const result = await service.listUsers(null, 20)

    expect(result.users).toHaveLength(1)
    expect(result.users[0]!.userId).toBe('11111111-1111-7111-8111-111111111111')
    expect(result.users[0]!.username).toBe('user@example.com')
    expect(result.users[0]!.email).toBe('user@example.com')
    expect(result.users[0]!.mobile).toBeNull()
    expect(result.users[0]!.profileCount).toBe(2)
    expect(result.users[0]!.hasIndividualProfile).toBe(true)
    expect(result.users[0]!.hasLegalProfile).toBe(true)
    expect(result.users[0]!.hasVerifiedProfile).toBe(true)
    expect(result.users[0]!.registrationDate).toBe('2026-01-15T10:00:00Z')
    expect(result.users[0]!.lastLogin).toBe('2026-06-01T08:00:00Z')
  })

  it('clamps limit between 1 and 100', async () => {
    const { pool } = mockPool()
    pool.query.mockResolvedValue({ rows: [] })
    vi.doMock('@barghsa/db', () => ({ getDbPool: () => pool }))
    const { CrmService: CrmSvc } = await import('./crm.service.js')
    service = new CrmSvc()

    await service.listUsers(null, 0)
    expect(pool.query).toHaveBeenCalledWith(
      expect.any(String),
      expect.arrayContaining([2]), // pageSize (1) + 1 for hasMore detection
    )

    await service.listUsers(null, 999)
    expect(pool.query).toHaveBeenCalledWith(
      expect.any(String),
      expect.arrayContaining([101]), // 100 + 1 for hasMore detection
    )
  })

  it('sets hasMore when more rows than limit', async () => {
    const { pool } = mockPool()
    const rows = Array.from({ length: 21 }, (_, i) => ({
      user_id: `00000000-0000-7000-8000-${String(i + 1).padStart(12, '0')}`,
      username: `user${i + 1}@example.com`,
      email: `user${i + 1}@example.com`,
      mobile: null,
      registration_date: new Date(Date.UTC(2026, 0, 15, 10, 0, i)).toISOString(),
      last_login: null,
      profile_count: 1,
      has_individual_profile: true,
      has_legal_profile: false,
      has_verified_profile: false,
    }))
    pool.query.mockResolvedValue({ rows })
    vi.doMock('@barghsa/db', () => ({ getDbPool: () => pool }))
    const { CrmService: CrmSvc } = await import('./crm.service.js')
    service = new CrmSvc()

    const result = await service.listUsers(null, 20)

    // After hasMore detection, we get pageSize (20) rows
    expect(result.users).toHaveLength(20)
    expect(result.hasMore).toBe(true)
    // Cursor should be a base64url-encoded JSON composite cursor
    expect(result.cursor).toBeTruthy()
    const decodedCursor = JSON.parse(Buffer.from(result.cursor!, 'base64url').toString('utf-8'))
    expect(decodedCursor.id).toBe('00000000-0000-7000-8000-000000000020')
    expect(decodedCursor.createdAt).toBe(rows[19]!.registration_date)
  })

  it('returns null cursor when end of list', async () => {
    const { pool } = mockPool()
    const rows = Array.from({ length: 3 }, (_, i) => ({
      user_id: `00000000-0000-7000-8000-${String(i + 1).padStart(12, '0')}`,
      username: `user${i + 1}@example.com`,
      email: `user${i + 1}@example.com`,
      mobile: null,
      registration_date: '2026-01-15T10:00:00Z',
      last_login: null,
      profile_count: 1,
      has_individual_profile: true,
      has_legal_profile: false,
      has_verified_profile: false,
    }))
    pool.query.mockResolvedValue({ rows })
    vi.doMock('@barghsa/db', () => ({ getDbPool: () => pool }))
    const { CrmService: CrmSvc } = await import('./crm.service.js')
    service = new CrmSvc()

    const result = await service.listUsers(null, 20)

    expect(result.users).toHaveLength(3)
    expect(result.hasMore).toBe(false)
    expect(result.cursor).toBeNull()
  })

  it('decodes and passes cursor to query', async () => {
    const { pool } = mockPool()
    pool.query.mockResolvedValue({ rows: [] })
    vi.doMock('@barghsa/db', () => ({ getDbPool: () => pool }))
    const { CrmService: CrmSvc } = await import('./crm.service.js')
    service = new CrmSvc()

    // Composite cursor: { id, createdAt } base64url-encoded
    const cursorPayload = { id: '00000000-0000-7000-8000-000000000020', createdAt: '2026-01-15T10:00:00Z' }
    const cursor = Buffer.from(JSON.stringify(cursorPayload), 'utf-8').toString('base64url')
    await service.listUsers(cursor, 10)

    expect(pool.query).toHaveBeenCalledWith(
      expect.stringContaining('WHERE (u.created_at, u.user_id) < ($2::timestamptz, $3::uuid)'),
      expect.arrayContaining([11, cursorPayload.createdAt, cursorPayload.id]),
    )
  })

  it('handles invalid cursor gracefully', async () => {
    const { pool } = mockPool()
    pool.query.mockResolvedValue({ rows: [] })
    vi.doMock('@barghsa/db', () => ({ getDbPool: () => pool }))
    const { CrmService: CrmSvc } = await import('./crm.service.js')
    service = new CrmSvc()

    // Invalid cursor — not valid JSON/not a valid composite cursor shape
    await service.listUsers('!!!invalid!!!', 10)

    // Should NOT contain WHERE clause with cursor params
    expect(pool.query).toHaveBeenCalledWith(
      expect.not.stringContaining('WHERE'),
      expect.arrayContaining([11]),
    )
  })

  it('returns correct results across multiple pages', async () => {
    const { pool } = mockPool()
    // Simulate 35 users; page size 20 → page 1 has 20, hasMore=true
    const allRows = Array.from({ length: 35 }, (_, i) => ({
      user_id: `00000000-0000-7000-8000-${String(i + 1).padStart(12, '0')}`,
      username: `user${i + 1}@example.com`,
      email: `user${i + 1}@example.com`,
      mobile: null,
      registration_date: new Date(Date.UTC(2026, 0, 15, 10, 0, i)).toISOString(),
      last_login: null,
      profile_count: 1,
      has_individual_profile: true,
      has_legal_profile: false,
      has_verified_profile: false,
    }))
    pool.query.mockResolvedValue({ rows: allRows })
    vi.doMock('@barghsa/db', () => ({ getDbPool: () => pool }))
    const { CrmService: CrmSvc } = await import('./crm.service.js')
    service = new CrmSvc()

    // Page 1 (no cursor)
    const page1 = await service.listUsers(null, 20)

    expect(page1.users).toHaveLength(20)
    expect(page1.hasMore).toBe(true)
    expect(page1.cursor).toBeTruthy()

    // Verify the cursor encodes the last user's id and createdAt
    const decodedCursor = JSON.parse(Buffer.from(page1.cursor!, 'base64url').toString('utf-8'))
    expect(decodedCursor.id).toBe(page1.users[19]!.userId)
    expect(decodedCursor.createdAt).toBe(page1.users[19]!.registrationDate)

    // Simulate page 2 by returning only the remaining 15 rows
    const remainingRows = allRows.slice(20)
    pool.query.mockResolvedValue({ rows: remainingRows })

    const page2 = await service.listUsers(page1.cursor, 20)

    expect(page2.users).toHaveLength(15)
    expect(page2.hasMore).toBe(false)
    expect(page2.cursor).toBeNull()
  })
})