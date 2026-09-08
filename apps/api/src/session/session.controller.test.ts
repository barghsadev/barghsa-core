import { describe, it, expect, beforeEach, vi } from 'vitest';
import { HttpException } from '@nestjs/common';
import { SessionController } from './session.controller.js';
import { SessionService } from './session.service.js';

describe('SessionController', () => {
  let controller: SessionController;
  let mockSessionService: { [K in keyof SessionService]: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    mockSessionService = {
      getUserSessions: vi.fn(),
      revokeOwnSessions: vi.fn(),
    } as any;
    controller = new SessionController(mockSessionService as unknown as SessionService);
  });

  // ────────────────────────────────────────────────────────────
  // listSessions
  // ────────────────────────────────────────────────────────────

  describe('listSessions', () => {
    it('returns mapped sessions for the authenticated user', async () => {
      const mockSessions = [
        {
          session_id: 'session-001',
          user_id: 'user-001',
          device_info: { ip: '1.2.3.4', userAgent: 'Mozilla/5.0' },
          created_at: '2026-08-25T08:00:00Z',
          updated_at: '2026-08-25T08:30:00Z',
          expires_at: '2026-08-26T08:00:00Z',
          idle_deadline: '2026-08-25T09:00:00Z',
        },
        {
          session_id: 'session-002',
          user_id: 'user-001',
          device_info: null,
          created_at: '2026-08-24T08:00:00Z',
          updated_at: '2026-08-24T08:30:00Z',
          expires_at: '2026-08-25T08:00:00Z',
          idle_deadline: '2026-08-24T09:00:00Z',
        },
      ];
      mockSessionService.getUserSessions.mockResolvedValue(mockSessions);

      const req = {
        session: { userId: 'user-001', sessionId: 'session-001' },
      } as any;

      const result = await controller.listSessions(req);

      expect(mockSessionService.getUserSessions).toHaveBeenCalledWith('user-001');
      expect(result).toHaveLength(2);
      expect(result[0]).toMatchObject({
        sessionId: 'session-001',
        deviceInfo: { ip: '1.2.3.4', userAgent: 'Mozilla/5.0' },
        isCurrentSession: true,
      });
      expect(result[1]).toMatchObject({
        sessionId: 'session-002',
        deviceInfo: null,
        isCurrentSession: false,
      });
    });

    it('returns empty array when user has no sessions', async () => {
      mockSessionService.getUserSessions.mockResolvedValue([]);

      const req = {
        session: { userId: 'user-001', sessionId: 'session-001' },
      } as any;

      const result = await controller.listSessions(req);
      expect(result).toEqual([]);
    });
  });

  describe('revokeSession', () => {
    it('passes the acting session and selected target into the protected mutation', async () => {
      mockSessionService.revokeOwnSessions.mockResolvedValue(1);
      const req = {
        ip: '127.0.0.1',
        session: { userId: 'user-001', sessionId: 'actor', csrfToken: 'csrf' },
      } as any;
      await expect(controller.revokeSession('target', req)).resolves.toEqual({
        message: 'Session revoked.',
      });
      expect(mockSessionService.revokeOwnSessions).toHaveBeenCalledWith(
        req.session,
        { targetSessionId: 'target' },
        '127.0.0.1'
      );
    });
    it.each(['missing', 'foreign'])('preserves the safe %s-target rejection', async (target) => {
      mockSessionService.revokeOwnSessions.mockRejectedValue(
        new HttpException({ error: 'NOT_FOUND:RESOURCE' }, 404)
      );
      const req = { session: { userId: 'user-001', sessionId: 'actor', csrfToken: 'csrf' } } as any;
      await expect(controller.revokeSession(target, req)).rejects.toMatchObject({ status: 404 });
    });
  });
  describe('revokeAllSessions', () => {
    it.each([0, 2])(
      'uses the mutation count of %s and confirms in the protected operation',
      async (count) => {
        mockSessionService.revokeOwnSessions.mockResolvedValue(count);
        const req = {
          session: { userId: 'user-001', sessionId: 'actor', csrfToken: 'csrf' },
        } as any;
        await expect(
          controller.revokeAllSessions({ password: 'correct-password' }, req)
        ).resolves.toEqual({
          message: count ? 'All 2 other session(s) revoked.' : 'No other sessions to revoke.',
          revokedCount: count,
        });
        expect(mockSessionService.revokeOwnSessions).toHaveBeenCalledWith(
          req.session,
          { password: 'correct-password' },
          null
        );
      }
    );
    it('preserves rejected password confirmation', async () => {
      mockSessionService.revokeOwnSessions.mockRejectedValue(
        new HttpException({ error: 'AUTH:LOGIN:INVALID_CREDENTIALS' }, 422)
      );
      const req = { session: { userId: 'user-001', sessionId: 'actor', csrfToken: 'csrf' } } as any;
      await expect(
        controller.revokeAllSessions({ password: 'wrong-password' }, req)
      ).rejects.toMatchObject({ status: 422 });
    });
    it('rejects invalid bodies before starting a mutation', async () => {
      const req = { session: { userId: 'user-001', sessionId: 'actor', csrfToken: 'csrf' } } as any;
      await expect(controller.revokeAllSessions({}, req)).rejects.toMatchObject({ status: 400 });
      expect(mockSessionService.revokeOwnSessions).not.toHaveBeenCalled();
    });
  });
});
