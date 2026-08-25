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
})