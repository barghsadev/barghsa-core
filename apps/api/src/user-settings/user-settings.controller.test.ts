import { describe, it, expect, beforeEach, vi } from 'vitest'
import { HttpException } from '@nestjs/common'
import { UserSettingsController } from './user-settings.controller.js'

// Shared mock pool so all calls to getDbPool() return the same instance
const mockClient = {
  query: vi.fn(),
  release: vi.fn(),
}
const mockPool = {
  query: vi.fn(),
  connect: vi.fn().mockResolvedValue(mockClient),
}

vi.mock('@barghsa/db', () => ({
  getDbPool: () => mockPool,
}))

// Mock the session guard decorator — it's a No-op in tests
vi.mock('../session/session.guard.js', () => ({
  SessionAuthGuard: vi.fn(),
}))

// Mock the rate-limit decorator
vi.mock('../rate-limit/rate-limit.decorator.js', () => ({
  RateLimit: () => () => {},
}))

describe('UserSettingsController — timezone endpoints', () => {
  let controller: UserSettingsController

  const fakeReq = {
    session: { userId: 'user-001', sessionId: 'session-001' },
  } as any

  beforeEach(() => {
    vi.clearAllMocks()
    controller = new UserSettingsController()
  })

  // ────────────────────────────────────────────────────────────
  // getTimezone
  // ────────────────────────────────────────────────────────────

  describe('getTimezone', () => {
    it('returns the stored timezone for the authenticated user', async () => {
      mockPool.query.mockResolvedValue({
        rows: [{ timezone: 'Asia/Tehran' }],
      })

      const result = await controller.getTimezone(fakeReq)

      expect(mockPool.query).toHaveBeenCalledWith(
        `SELECT timezone FROM users WHERE user_id = $1`,
        ['user-001'],
      )
      expect(result).toEqual({ timezone: 'Asia/Tehran' })
    })

    it('returns the correct timezone when a different one is set', async () => {
      mockPool.query.mockResolvedValue({
        rows: [{ timezone: 'America/New_York' }],
      })

      const result = await controller.getTimezone(fakeReq)

      expect(result).toEqual({ timezone: 'America/New_York' })
    })

    it('throws 404 when the user is not found', async () => {
      mockPool.query.mockResolvedValue({ rows: [] })

      await expect(controller.getTimezone(fakeReq)).rejects.toThrow(HttpException)
      await expect(controller.getTimezone(fakeReq)).rejects.toMatchObject({
        status: 404,
      })
    })
  })

  // ────────────────────────────────────────────────────────────
  // updateTimezone
  // ────────────────────────────────────────────────────────────

  describe('updateTimezone', () => {
    it('updates and returns the new timezone for a valid IANA string', async () => {
      mockPool.query.mockResolvedValue({
        rows: [{ timezone: 'Europe/London' }],
      })

      const result = await controller.updateTimezone(
        { timezone: 'Europe/London' },
        fakeReq,
      )

      expect(mockPool.query).toHaveBeenCalledWith(
        `UPDATE users SET timezone = $1, updated_at = NOW() WHERE user_id = $2 RETURNING timezone`,
        ['Europe/London', 'user-001'],
      )
      expect(result).toEqual({ timezone: 'Europe/London' })
    })

    it('rejects empty timezone string with 400', async () => {
      await expect(
        controller.updateTimezone({ timezone: '' }, fakeReq),
      ).rejects.toMatchObject({ status: 400 })
    })

    it('rejects null/undefined timezone with 400', async () => {
      await expect(
        controller.updateTimezone({ timezone: null as any }, fakeReq),
      ).rejects.toMatchObject({ status: 400 })
    })

    it('rejects non-string timezone with 400', async () => {
      await expect(
        controller.updateTimezone({ timezone: 123 as any }, fakeReq),
      ).rejects.toMatchObject({ status: 400 })
    })

    it('rejects invalid IANA timezone string with 400', async () => {
      await expect(
        controller.updateTimezone({ timezone: 'Foo/Bar' }, fakeReq),
      ).rejects.toMatchObject({ status: 400 })
    })

    it('rejects completely bogus timezone string', async () => {
      await expect(
        controller.updateTimezone({ timezone: 'not-a-timezone' }, fakeReq),
      ).rejects.toMatchObject({ status: 400 })
    })

    it('accepts "UTC" as a valid timezone', async () => {
      mockPool.query.mockResolvedValue({
        rows: [{ timezone: 'UTC' }],
      })

      const result = await controller.updateTimezone(
        { timezone: 'UTC' },
        fakeReq,
      )

      expect(result).toEqual({ timezone: 'UTC' })
    })

    it('throws 404 when the user is not found on update', async () => {
      mockPool.query.mockResolvedValue({ rows: [] })

      await expect(
        controller.updateTimezone({ timezone: 'Asia/Tehran' }, fakeReq),
      ).rejects.toMatchObject({ status: 404 })
    })
  })

  // ────────────────────────────────────────────────────────────
  // getMarketingConsent / updateMarketingConsent (T-05.05.03)
  // ────────────────────────────────────────────────────────────

  describe('getMarketingConsent', () => {
    it('returns empty opted-out state when the user has no active profiles', async () => {
      mockPool.query.mockResolvedValueOnce({ rows: [] }) // profile lookup

      const result = await controller.getMarketingConsent(fakeReq)

      expect(mockPool.query).toHaveBeenCalledWith(
        `SELECT id FROM profiles WHERE user_id = $1 AND archived = false ORDER BY is_default DESC, created_at ASC`,
        ['user-001'],
      )
      expect(result).toEqual({
        channels: {
          email: { optedIn: false, lastChangedAt: null },
          sms: { optedIn: false, lastChangedAt: null },
        },
      })
    })

    it('returns stored consent rows for the default profile', async () => {
      mockPool.query
        .mockResolvedValueOnce({ rows: [{ id: 'profile-1' }] }) // profiles
        .mockResolvedValueOnce({
          // preferences
          rows: [
            { channel: 'email', marketing_opted_in: true, updated_at: '2026-01-01T00:00:00Z' },
            { channel: 'sms', marketing_opted_in: false, updated_at: null },
          ],
        })

      const result = await controller.getMarketingConsent(fakeReq)

      expect(mockPool.query).toHaveBeenCalledWith(
        expect.stringContaining('FROM user_notification_preferences'),
        ['profile-1'],
      )
      expect(result).toEqual({
        channels: {
          email: { optedIn: true, lastChangedAt: '2026-01-01T00:00:00Z' },
          sms: { optedIn: false, lastChangedAt: null },
        },
      })
    })
  })

  describe('updateMarketingConsent', () => {
    it('rejects a request with neither email nor sms', async () => {
      await expect(
        controller.updateMarketingConsent({}, fakeReq),
      ).rejects.toMatchObject({ status: 400 })
    })

    it('throws 404 when the user has no active profiles', async () => {
      mockPool.query.mockResolvedValueOnce({ rows: [] }) // profiles

      await expect(
        controller.updateMarketingConsent({ email: true }, fakeReq),
      ).rejects.toMatchObject({ status: 404 })
    })

    it('runs upserts and audit inside a single transaction and reports updated state', async () => {
      // profiles (pool.query #1) -> [{id: profile-1}, {id: profile-2}]
      mockPool.query.mockResolvedValueOnce({
        rows: [{ id: 'profile-1' }, { id: 'profile-2' }],
      })

      // Read back the default profile state after commit (pool.query #2).
      mockPool.query.mockResolvedValueOnce({
        rows: [
          { channel: 'email', marketing_opted_in: true, updated_at: '2026-01-01T00:00:00Z' },
          { channel: 'sms', marketing_opted_in: true, updated_at: '2026-01-01T00:00:00Z' },
        ],
      })

      // Transaction flow on the client: BEGIN, 4 upserts (2 profiles x 2 channels),
      // 1 audit insert, COMMIT.
      mockClient.query
        .mockResolvedValueOnce({ rows: [] }) // BEGIN
        .mockResolvedValueOnce({ rows: [] }) // upsert profile-1 email
        .mockResolvedValueOnce({ rows: [] }) // upsert profile-1 sms
        .mockResolvedValueOnce({ rows: [] }) // upsert profile-2 email
        .mockResolvedValueOnce({ rows: [] }) // upsert profile-2 sms
        .mockResolvedValueOnce({ rows: [] }) // audit insert
        .mockResolvedValueOnce({ rows: [] }) // COMMIT

      const result = await controller.updateMarketingConsent(
        { email: true, sms: true },
        { ...fakeReq, ip: '203.0.113.5' } as any,
      )

      expect(result).toEqual({
        channels: {
          email: { optedIn: true, lastChangedAt: '2026-01-01T00:00:00Z' },
          sms: { optedIn: true, lastChangedAt: '2026-01-01T00:00:00Z' },
        },
      })

      // Transaction boundaries present.
      const clientQueries = mockClient.query.mock.calls.map((c) => String(c[0]))
      expect(clientQueries[0]).toBe('BEGIN')
      expect(clientQueries[clientQueries.length - 1]).toBe('COMMIT')

      // Audit insert happened inside the transaction with correct details.
      const auditCall = mockClient.query.mock.calls.find((call) =>
        String(call[0]).startsWith('INSERT INTO audit_log'),
      )
      expect(auditCall).toBeDefined()
      const auditParams = auditCall![1] as unknown[]
      expect(auditParams[2]).toBe('marketing_consent_changed')
      expect((auditParams[3] as string).includes('"email":true')).toBe(true)
      expect((auditParams[3] as string).includes('"sms":true')).toBe(true)
      expect(auditParams[5]).toBe('203.0.113.5')

      expect(mockClient.release).toHaveBeenCalled()
    })

    it('rolls back and does not report a change when a statement fails, then rethrows', async () => {
      mockPool.query.mockResolvedValueOnce({
        rows: [{ id: 'profile-1' }],
      })

      mockClient.query
        .mockResolvedValueOnce({ rows: [] }) // BEGIN
        .mockRejectedValueOnce(new Error('db down')) // upsert fails
        .mockResolvedValueOnce({ rows: [] }) // ROLLBACK (catch)

      await expect(
        controller.updateMarketingConsent({ email: true }, fakeReq),
      ).rejects.toMatchObject({ message: 'db down' })

      const clientQueries = mockClient.query.mock.calls.map((c) => String(c[0]))
      expect(clientQueries).toContain('ROLLBACK')
      expect(clientQueries).not.toContain('COMMIT')
      expect(mockClient.release).toHaveBeenCalled()
    })

    it('only touches channels that were provided, across all profiles', async () => {
      mockPool.query
        .mockResolvedValueOnce({ rows: [{ id: 'profile-1' }, { id: 'profile-2' }] }) // profiles
        .mockResolvedValueOnce({
          // read after commit
          rows: [
            { channel: 'email', marketing_opted_in: false, updated_at: null },
            { channel: 'sms', marketing_opted_in: false, updated_at: null },
          ],
        })

      mockClient.query
        .mockResolvedValueOnce({ rows: [] }) // BEGIN
        .mockResolvedValueOnce({ rows: [] }) // upsert profile-1 email
        .mockResolvedValueOnce({ rows: [] }) // upsert profile-2 email
        .mockResolvedValueOnce({ rows: [] }) // audit insert
        .mockResolvedValueOnce({ rows: [] }) // COMMIT

      const result = await controller.updateMarketingConsent({ email: false }, fakeReq)

      expect(result).toBeDefined()
      // Only email was upserted, once per profile — no SMS inserts.
      const insertCalls = mockClient.query.mock.calls.filter((call) =>
        String(call[0]).startsWith('INSERT INTO user_notification_preferences'),
      )
      expect(insertCalls).toHaveLength(2)
      for (const call of insertCalls) {
        const params = (call[1] as unknown[] | undefined) ?? []
        expect(params[2]).toBe('email')
      }
    })
  })
})