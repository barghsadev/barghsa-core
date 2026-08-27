import { describe, it, expect, beforeEach, vi } from 'vitest'
import { HttpException } from '@nestjs/common'
import { UserSettingsController } from './user-settings.controller.js'

// Shared mock pool so all calls to getDbPool() return the same instance
const mockPool = {
  query: vi.fn(),
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

    it('upserts consent for each provided channel across all profiles and logs audit', async () => {
      // profiles -> [{id: profile-1}, {id: profile-2}]
      mockPool.query.mockResolvedValueOnce({
        rows: [{ id: 'profile-1' }, { id: 'profile-2' }],
      })

      // Simulate the audit insert returning nothing and the read returning
      // the newly-opted-in state for profile-1.
      mockPool.query
        .mockResolvedValueOnce({ rows: [] }) // upsert profile-1 email
        .mockResolvedValueOnce({ rows: [] }) // upsert profile-1 sms
        .mockResolvedValueOnce({ rows: [] }) // upsert profile-2 email
        .mockResolvedValueOnce({ rows: [] }) // upsert profile-2 sms
        .mockResolvedValueOnce({ rows: [] }) // audit insert
        .mockResolvedValueOnce({
          // read the default profile state
          rows: [
            { channel: 'email', marketing_opted_in: true, updated_at: '2026-01-01T00:00:00Z' },
            { channel: 'sms', marketing_opted_in: true, updated_at: '2026-01-01T00:00:00Z' },
          ],
        })

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

      // Audit event should have been recorded.
      const auditCall = mockPool.query.mock.calls.find((call) =>
        String(call[0]).includes('INSERT INTO audit_log'),
      )
      expect(auditCall).toBeDefined()
      const auditParams = auditCall![1] as unknown[]
      expect(auditParams[2]).toBe('marketing_consent_changed')
      expect((auditParams[3] as string).includes('"email":true')).toBe(true)
      expect((auditParams[3] as string).includes('"sms":true')).toBe(true)
      expect(auditParams[5]).toBe('203.0.113.5')
    })

    it('only touches channels that were provided', async () => {
      mockPool.query.mockResolvedValueOnce({
        rows: [{ id: 'profile-1' }],
      })
      mockPool.query
        .mockResolvedValueOnce({ rows: [] }) // upsert profile-1 email only
        .mockResolvedValueOnce({ rows: [] }) // audit insert
        .mockResolvedValueOnce({
          rows: [
            { channel: 'email', marketing_opted_in: false, updated_at: null },
            { channel: 'sms', marketing_opted_in: false, updated_at: null },
          ],
        })

      const result = await controller.updateMarketingConsent(
        { email: false },
        fakeReq,
      )

      expect(result).toBeDefined()
      // Verify only the email channel was upserted (one INSERT for profile-1).
      const insertCalls = mockPool.query.mock.calls.filter((call) =>
        String(call[0]).startsWith('INSERT INTO user_notification_preferences'),
      )
      expect(insertCalls).toHaveLength(1)
      const params = (insertCalls[0]?.[1] as unknown[] | undefined) ?? []
      expect(params[2]).toBe('email')
    })
  })
})