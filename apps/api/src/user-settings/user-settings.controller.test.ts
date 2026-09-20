import { describe, it, expect, beforeEach, vi } from 'vitest';
import { HttpException } from '@nestjs/common';
import { UserSettingsController } from './user-settings.controller.js';

// Shared mock pool so all calls to getDbPool() return the same instance
const mockClient = {
  query: vi.fn(),
  release: vi.fn(),
};
const mockPool = {
  query: vi.fn(),
  connect: vi.fn().mockResolvedValue(mockClient),
};

vi.mock('@barghsa/db', () => ({
  getDbPool: () => mockPool,
}));

// Mock the session guard decorator — it's a No-op in tests
vi.mock('../session/session.guard.js', () => ({
  SessionAuthGuard: vi.fn(),
}));

// Mock the rate-limit decorator
vi.mock('../rate-limit/rate-limit.decorator.js', () => ({
  RateLimit: () => () => {},
}));

describe('UserSettingsController — timezone endpoints', () => {
  let controller: UserSettingsController;

  const fakeReq = {
    session: { userId: 'user-001', sessionId: 'session-001', csrfToken: 'csrf' },
  } as any;

  beforeEach(() => {
    vi.clearAllMocks();
    mockClient.query.mockResolvedValue({
      rows: [{ timezone: 'Asia/Tehran', disabled_at: null, active: true, csrf_token: 'csrf' }],
    });
    controller = new UserSettingsController();
  });

  // ────────────────────────────────────────────────────────────
  // getTimezone
  // ────────────────────────────────────────────────────────────

  describe('getTimezone', () => {
    it('returns the stored timezone for the authenticated user', async () => {
      mockPool.query.mockResolvedValue({
        rows: [{ timezone: 'Asia/Tehran' }],
      });

      const result = await controller.getTimezone(fakeReq);

      expect(mockPool.query).toHaveBeenCalledWith(`SELECT timezone FROM users WHERE user_id = $1`, [
        'user-001',
      ]);
      expect(result).toEqual({ timezone: 'Asia/Tehran' });
    });

    it('returns the correct timezone when a different one is set', async () => {
      mockPool.query.mockResolvedValue({
        rows: [{ timezone: 'America/New_York' }],
      });

      const result = await controller.getTimezone(fakeReq);

      expect(result).toEqual({ timezone: 'America/New_York' });
    });

    it('throws 404 when the user is not found', async () => {
      mockPool.query.mockResolvedValue({ rows: [] });

      await expect(controller.getTimezone(fakeReq)).rejects.toThrow(HttpException);
      await expect(controller.getTimezone(fakeReq)).rejects.toMatchObject({
        status: 404,
      });
    });
  });

  // ────────────────────────────────────────────────────────────
  // updateTimezone
  // ────────────────────────────────────────────────────────────

  describe('updateTimezone', () => {
    it('updates and returns the new timezone for a valid IANA string', async () => {
      mockPool.query.mockResolvedValue({
        rows: [{ timezone: 'Europe/London' }],
      });

      const result = await controller.updateTimezone({ timezone: 'Europe/London' }, fakeReq);

      expect(mockClient.query).toHaveBeenCalledWith(
        'UPDATE users SET timezone=$1,updated_at=NOW() WHERE user_id=$2',
        ['Europe/London', 'user-001']
      );
      expect(result).toEqual({ timezone: 'Europe/London' });
    });

    it('rejects empty timezone string with 400', async () => {
      await expect(controller.updateTimezone({ timezone: '' }, fakeReq)).rejects.toMatchObject({
        status: 400,
      });
    });

    it('rejects null/undefined timezone with 400', async () => {
      await expect(
        controller.updateTimezone({ timezone: null as any }, fakeReq)
      ).rejects.toMatchObject({ status: 400 });
    });

    it('rejects non-string timezone with 400', async () => {
      await expect(
        controller.updateTimezone({ timezone: 123 as any }, fakeReq)
      ).rejects.toMatchObject({ status: 400 });
    });

    it('rejects invalid IANA timezone string with 400', async () => {
      await expect(
        controller.updateTimezone({ timezone: 'Foo/Bar' }, fakeReq)
      ).rejects.toMatchObject({ status: 400 });
    });

    it('rejects completely bogus timezone string', async () => {
      await expect(
        controller.updateTimezone({ timezone: 'not-a-timezone' }, fakeReq)
      ).rejects.toMatchObject({ status: 400 });
    });

    it('accepts "UTC" as a valid timezone', async () => {
      mockPool.query.mockResolvedValue({
        rows: [{ timezone: 'UTC' }],
      });

      const result = await controller.updateTimezone({ timezone: 'UTC' }, fakeReq);

      expect(result).toEqual({ timezone: 'UTC' });
    });

    it('rejects a session whose account no longer exists on update', async () => {
      mockClient.query.mockResolvedValue({ rows: [] });

      await expect(
        controller.updateTimezone({ timezone: 'Asia/Tehran' }, fakeReq)
      ).rejects.toMatchObject({ status: 401 });
    });
  });

  // ────────────────────────────────────────────────────────────
  // getMarketingConsent / updateMarketingConsent (T-05.05.03)
  // ────────────────────────────────────────────────────────────

  describe('marketing consent', () => {
    it('returns opted-out defaults when the current owned profile has no consent', async () => {
      mockPool.query.mockResolvedValueOnce({ rows: [] });
      expect(await controller.getMarketingConsent(fakeReq)).toEqual({
        channels: {
          email: { optedIn: false, lastChangedAt: null },
          sms: { optedIn: false, lastChangedAt: null },
        },
      });
    });
    it('returns selected-profile channel state from one scoped read', async () => {
      mockPool.query.mockResolvedValueOnce({
        rows: [{ channel: 'email', marketing_opted_in: true, updated_at: '2026-01-01T00:00:00Z' }],
      });
      expect(await controller.getMarketingConsent(fakeReq)).toEqual({
        channels: {
          email: { optedIn: true, lastChangedAt: '2026-01-01T00:00:00Z' },
          sms: { optedIn: false, lastChangedAt: null },
        },
      });
    });
    it.each([
      null,
      {},
      [],
      { email: 'true' },
      { email: true, sms: 'false' },
      { email: true, profileId: 'other' },
    ])('rejects invalid consent input %j before opening a transaction', async (body) => {
      await expect(controller.updateMarketingConsent(body, fakeReq)).rejects.toMatchObject({
        status: 400,
      });
      expect(mockPool.connect).not.toHaveBeenCalled();
    });
  });
});
