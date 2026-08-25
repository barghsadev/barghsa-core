import { describe, it, expect, beforeEach, vi } from 'vitest'
import { CrmService } from './crm.service.js'

// ─── Helpers ──────────────────────────────────────────────────────────

function mockPool() {
  const mockQuery = vi.fn()
  const pool = { query: mockQuery }
  return { mockQuery, pool }
}

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

describe('CrmService.listUsers — profile type filter', () => {
  it('filters by INDIVIDUAL profile type', async () => {
    const { pool } = mockPool()
    pool.query.mockResolvedValue({ rows: [] })
    vi.doMock('@barghsa/db', () => ({ getDbPool: () => pool }))
    const { CrmService: CrmSvc } = await import('./crm.service.js')
    service = new CrmSvc()

    await service.listUsers(null, 10, { type: 'INDIVIDUAL' })

    expect(pool.query).toHaveBeenCalledWith(
      expect.stringContaining("p.profile_type = $2"),
      expect.arrayContaining([11, 'INDIVIDUAL']),
    )
  })

  it('filters by LEGAL profile type', async () => {
    const { pool } = mockPool()
    pool.query.mockResolvedValue({ rows: [] })
    vi.doMock('@barghsa/db', () => ({ getDbPool: () => pool }))
    const { CrmService: CrmSvc } = await import('./crm.service.js')
    service = new CrmSvc()

    await service.listUsers(null, 10, { type: 'LEGAL' })

    expect(pool.query).toHaveBeenCalledWith(
      expect.stringContaining("p.profile_type = $2"),
      expect.arrayContaining([11, 'LEGAL']),
    )
  })
})

describe('CrmService.listUsers — verification status filter', () => {
  it('filters by VERIFIED', async () => {
    const { pool } = mockPool()
    pool.query.mockResolvedValue({ rows: [] })
    vi.doMock('@barghsa/db', () => ({ getDbPool: () => pool }))
    const { CrmService: CrmSvc } = await import('./crm.service.js')
    service = new CrmSvc()

    await service.listUsers(null, 10, { verification: 'VERIFIED' })

    expect(pool.query).toHaveBeenCalledWith(
      expect.stringContaining("bool_or(p.status = 'VERIFIED') = true"),
      expect.arrayContaining([11]),
    )
  })

  it('filters by PENDING', async () => {
    const { pool } = mockPool()
    pool.query.mockResolvedValue({ rows: [] })
    vi.doMock('@barghsa/db', () => ({ getDbPool: () => pool }))
    const { CrmService: CrmSvc } = await import('./crm.service.js')
    service = new CrmSvc()

    await service.listUsers(null, 10, { verification: 'PENDING' })

    expect(pool.query).toHaveBeenCalledWith(
      expect.stringContaining("bool_or(p.status = 'PENDING')"),
      expect.arrayContaining([11]),
    )
  })

  it('filters by DISABLED', async () => {
    const { pool } = mockPool()
    pool.query.mockResolvedValue({ rows: [] })
    vi.doMock('@barghsa/db', () => ({ getDbPool: () => pool }))
    const { CrmService: CrmSvc } = await import('./crm.service.js')
    service = new CrmSvc()

    await service.listUsers(null, 10, { verification: 'DISABLED' })

    expect(pool.query).toHaveBeenCalledWith(
      expect.stringContaining("bool_or(p.status = 'DISABLED')"),
      expect.arrayContaining([11]),
    )
  })
})

describe('CrmService.listUsers — search filter', () => {
  it('includes search terms in the query', async () => {
    const { pool } = mockPool()
    pool.query.mockResolvedValue({ rows: [] })
    vi.doMock('@barghsa/db', () => ({ getDbPool: () => pool }))
    const { CrmService: CrmSvc } = await import('./crm.service.js')
    service = new CrmSvc()

    await service.listUsers(null, 10, { search: 'john' })

    // Should contain both full-text and ILIKE search patterns
    expect(pool.query).toHaveBeenCalledWith(
      expect.stringContaining('to_tsvector'),
      expect.any(Array),
    )
    // The params should include the search term and ILIKE patterns
    const callArgs = (pool.query as ReturnType<typeof vi.fn>).mock.calls[0]!
    const params = callArgs[1] as unknown[]
    expect(params).toContain('john')
    expect(params).toContain('%john%')
  })
})

describe('CrmService.listUsers — date range filter', () => {
  it('applies dateFrom filter', async () => {
    const { pool } = mockPool()
    pool.query.mockResolvedValue({ rows: [] })
    vi.doMock('@barghsa/db', () => ({ getDbPool: () => pool }))
    const { CrmService: CrmSvc } = await import('./crm.service.js')
    service = new CrmSvc()

    await service.listUsers(null, 10, { dateFrom: '2026-06-01T00:00:00Z' })

    expect(pool.query).toHaveBeenCalledWith(
      expect.stringContaining('u.created_at >= $2::timestamptz'),
      expect.arrayContaining([11, '2026-06-01T00:00:00Z']),
    )
  })

  it('applies dateTo filter', async () => {
    const { pool } = mockPool()
    pool.query.mockResolvedValue({ rows: [] })
    vi.doMock('@barghsa/db', () => ({ getDbPool: () => pool }))
    const { CrmService: CrmSvc } = await import('./crm.service.js')
    service = new CrmSvc()

    await service.listUsers(null, 10, { dateTo: '2026-12-31T23:59:59Z' })

    expect(pool.query).toHaveBeenCalledWith(
      expect.stringContaining('u.created_at <= $2::timestamptz'),
      expect.arrayContaining([11, '2026-12-31T23:59:59Z']),
    )
  })

  it('applies both dateFrom and dateTo', async () => {
    const { pool } = mockPool()
    pool.query.mockResolvedValue({ rows: [] })
    vi.doMock('@barghsa/db', () => ({ getDbPool: () => pool }))
    const { CrmService: CrmSvc } = await import('./crm.service.js')
    service = new CrmSvc()

    await service.listUsers(null, 10, {
      dateFrom: '2026-06-01T00:00:00Z',
      dateTo: '2026-12-31T23:59:59Z',
    })

    expect(pool.query).toHaveBeenCalledWith(
      expect.stringContaining('u.created_at >= $2::timestamptz'),
      expect.any(Array),
    )
    expect(pool.query).toHaveBeenCalledWith(
      expect.stringContaining('u.created_at <= $3::timestamptz'),
      expect.any(Array),
    )
  })
})

describe('CrmService.listUsers — sort order', () => {
  it('defaults to DESC when no order specified', async () => {
    const { pool } = mockPool()
    pool.query.mockResolvedValue({ rows: [] })
    vi.doMock('@barghsa/db', () => ({ getDbPool: () => pool }))
    const { CrmService: CrmSvc } = await import('./crm.service.js')
    service = new CrmSvc()

    await service.listUsers(null, 10)

    expect(pool.query).toHaveBeenCalledWith(
      expect.stringContaining('ORDER BY u.created_at DESC'),
      expect.any(Array),
    )
  })

  it('respects ASC order', async () => {
    const { pool } = mockPool()
    pool.query.mockResolvedValue({ rows: [] })
    vi.doMock('@barghsa/db', () => ({ getDbPool: () => pool }))
    const { CrmService: CrmSvc } = await import('./crm.service.js')
    service = new CrmSvc()

    await service.listUsers(null, 10, { order: 'asc' })

    expect(pool.query).toHaveBeenCalledWith(
      expect.stringContaining('ORDER BY u.created_at ASC'),
      expect.any(Array),
    )
  })
})