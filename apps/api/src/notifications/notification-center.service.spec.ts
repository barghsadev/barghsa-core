import { describe, it, expect, vi } from 'vitest'
import {
  NotificationCenterService,
  encodeCursor,
  decodeCursor,
} from './notification-center.service.js'

// The service talks to Postgres via a query pool. These tests inject a mock
// pool to exercise the cursor-keyset pagination, filtering, and read-state
// mutation logic that the T-05.02.02 acceptance criteria call out directly.
// Row-mapping / JSON plumbing is covered at integration level.

function makeMockPool() {
  return {
    query: vi.fn(),
  }
}

const row = (over: Record<string, unknown>) => ({
  id: 'id-' + Math.random().toString(36).slice(2),
  type: 'profile_verified',
  titleI18nKey: 'notifications.profile_verified.title',
  bodyI18nKey: 'notifications.profile_verified.body',
  params: {},
  linkRoute: null,
  linkParams: null,
  isRead: false,
  readAt: null,
  createdAt: new Date('2026-08-27T06:00:00.000Z'),
  ...over,
})

describe('cursor encode/decode', () => {
  it('round-trips a (createdAt, id) position', () => {
    const date = new Date('2026-08-27T06:00:00.123Z')
    const cursor = encodeCursor(date, 'abc-123')
    expect(decodeCursor(cursor)).toEqual({ createdAt: date, id: 'abc-123' })
  })

  it('accepts an ISO string in encodeCursor', () => {
    const cursor = encodeCursor('2026-08-27T06:00:00.000Z', 'x')
    expect(decodeCursor(cursor).createdAt.toISOString()).toBe(
      '2026-08-27T06:00:00.000Z',
    )
  })

  it('rejects a malformed cursor (400 HTTP error)', () => {
    expect(() => decodeCursor('%%%not-base64%%%')).toThrow()
    // Valid base64 but no separator / not a date.
    expect(() => decodeCursor(Buffer.from('nodate|id').toString('base64url'))).toThrow()
    expect(() => decodeCursor(Buffer.from('2026-08-27T06:00:00.000Z|').toString('base64url'))).toThrow()
  })
})

describe('list', () => {
  it('returns newest page with unread count when no cursor', async () => {
    const pool = makeMockPool()
    const now = new Date('2026-08-27T06:00:00.000Z')
    pool.query
      .mockResolvedValueOnce({
        rows: [row({ createdAt: now }), row({ createdAt: now })],
      })
      .mockResolvedValueOnce({ rows: [{ n: '3' }] })

    const svc = new NotificationCenterService(pool)
    const page = await svc.list('profile-1', { limit: 50 })

    expect(pool.query).toHaveBeenCalledTimes(2)
    const [, params] = pool.query.mock.calls[0] as [string, unknown[]]
    // The list query (first call) is scoped to the profile.
    expect(params).toEqual(['profile-1', 51])
    expect(page.data).toHaveLength(2)
    expect(page.next_cursor).toBeNull()
    expect(page.unread_count).toBe(3)
  })

  it('emits a next_cursor when a following older page exists', async () => {
    const pool = makeMockPool()
    // 3 rows for a limit of 2 => hasMore, but page keeps only 2.
    const a = row({ createdAt: new Date('2026-08-27T06:02:00.000Z') })
    const b = row({ createdAt: new Date('2026-08-27T06:01:00.000Z') })
    const c = row({ createdAt: new Date('2026-08-27T06:00:00.000Z') })
    pool.query
      .mockResolvedValueOnce({ rows: [a, b, c] })
      .mockResolvedValueOnce({ rows: [{ n: '0' }] })

    const svc = new NotificationCenterService(pool)
    const page = await svc.list('profile-1', { limit: 2 })

    expect(page.data).toHaveLength(2)
    expect(page.next_cursor).toBeTruthy()
    // decode the emitted cursor: it is the last kept row's position.
    const pos = decodeCursor(page.next_cursor!)
    expect(pos.id).toBe(b.id)
  })

  it('newer direction returns newest-first and emits a cursor from the newest kept row', async () => {
    const pool = makeMockPool()
    // Both directions fetch DESC (newest-first); the mock simulates that.
    const newest = row({ createdAt: new Date('2026-08-27T06:02:00.000Z') })
    const mid = row({ createdAt: new Date('2026-08-27T06:01:00.000Z') })
    const older = row({ createdAt: new Date('2026-08-27T06:00:00.000Z') })
    pool.query
      .mockResolvedValueOnce({ rows: [newest, mid, older] })
      .mockResolvedValueOnce({ rows: [{ n: '0' }] })

    const svc = new NotificationCenterService(pool)
    // Pass a cursor so the list generates the `>` row-comparison condition.
    const cursor = encodeCursor(new Date('2026-08-27T05:00:00.000Z'), 'seed')
    const page = await svc.list('profile-1', {
      limit: 2,
      direction: 'newer',
      cursor,
    })

    expect(page.data[0]!.id).toBe(newest.id)
    expect(page.data[1]!.id).toBe(mid.id)
    expect(page.next_cursor).toBeTruthy()
    // Continuous newer cursor anchors on the newest kept row.
    const pos = decodeCursor(page.next_cursor!)
    expect(pos.id).toBe(newest.id)

    // Newer uses a `>` row comparison with the same newest-first ORDER BY, so
    // it is symmetric with `older` (no duplicate rows when continuing).
    const [sql] = pool.query.mock.calls[0] as [string, unknown[]]
    expect(sql).toContain('(created_at, id) >')
    expect(sql).toContain('ORDER BY created_at DESC, id DESC')
  })

  it('clamps limit to MAX_LIMIT', async () => {
    const pool = makeMockPool()
    pool.query
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ n: '0' }] })

    const svc = new NotificationCenterService(pool)
    await svc.list('profile-1', { limit: 999 })

    const [, params] = pool.query.mock.calls[0] as [string, unknown[]]
    // limit+1 = 101 after clamping to MAX_LIMIT (100).
    expect(params).toEqual(['profile-1', 101])
  })

  it('filters unread rows and scopes to the profile', async () => {
    const pool = makeMockPool()
    pool.query
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ n: '1' }] })

    const svc = new NotificationCenterService(pool)
    await svc.list('profile-9', { filter: 'unread', limit: 10 })

    const [sql, params] = pool.query.mock.calls[0] as [string, unknown[]]
    expect(sql).toContain('is_read = false')
    expect(params).toContain('profile-9')
  })
})

describe('markRead', () => {
  it('marks the row read and is profile-scoped', async () => {
    const pool = makeMockPool()
    pool.query.mockResolvedValueOnce({ rowCount: 1 })

    const svc = new NotificationCenterService(pool)
    await svc.markRead('profile-1', 'notif-1')

    const [, params] = pool.query.mock.calls[0] as [string, unknown[]]
    expect(params).toEqual(['notif-1', 'profile-1'])
  })

  it('throws 404 when the row does not belong to the profile', async () => {
    const pool = makeMockPool()
    pool.query.mockResolvedValueOnce({ rowCount: 0 })

    const svc = new NotificationCenterService(pool)
    await expect(svc.markRead('profile-1', 'other-id')).rejects.toThrow()
  })
})

describe('markAllRead', () => {
  it('updates only unread rows of the profile and returns the count', async () => {
    const pool = makeMockPool()
    pool.query.mockResolvedValueOnce({ rowCount: 5 })

    const svc = new NotificationCenterService(pool)
    const n = await svc.markAllRead('profile-1')

    const [sql, params] = pool.query.mock.calls[0] as [string, unknown[]]
    expect(sql).toContain('is_read = false')
    expect(params).toEqual(['profile-1'])
    expect(n).toBe(5)
  })
})
