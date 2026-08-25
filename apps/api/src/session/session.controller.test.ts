import { describe, it, expect, beforeEach, vi } from 'vitest'
import { HttpException } from '@nestjs/common'
import { SessionController } from './session.controller.js'
import { SessionService } from './session.service.js'

describe('SessionController', () => {
  let controller: SessionController
  let mockSessionService: { [K in keyof SessionService]: ReturnType<typeof vi.fn> }

  beforeEach(() => {
    mockSessionService = {
      getUserSessions: vi.fn(),
      getSessionById: vi.fn(),
      revokeSession: vi.fn(),
      revokeAllUserSessions: vi.fn(),
      verifyUserPassword: vi.fn(),
    } as any
    controller = new SessionController(mockSessionService as unknown as SessionService)
  })

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
      ]
      mockSessionService.getUserSessions.mockResolvedValue(mockSessions)

      const req = {
        session: { userId: 'user-001', sessionId: 'session-001' },
      } as any

      const result = await controller.listSessions(req)

      expect(mockSessionService.getUserSessions).toHaveBeenCalledWith('user-001')
      expect(result).toHaveLength(2)
      expect(result[0]).toMatchObject({
        sessionId: 'session-001',
        deviceInfo: { ip: '1.2.3.4', userAgent: 'Mozilla/5.0' },
        isCurrentSession: true,
      })
      expect(result[1]).toMatchObject({
        sessionId: 'session-002',
        deviceInfo: null,
        isCurrentSession: false,
      })
    })

    it('returns empty array when user has no sessions', async () => {
      mockSessionService.getUserSessions.mockResolvedValue([])

      const req = {
        session: { userId: 'user-001', sessionId: 'session-001' },
      } as any

      const result = await controller.listSessions(req)
      expect(result).toEqual([])
    })
  })

  // ────────────────────────────────────────────────────────────
  // revokeSession
  // ────────────────────────────────────────────────────────────

  describe('revokeSession', () => {
    it('revokes a session owned by the authenticated user', async () => {
      mockSessionService.getSessionById.mockResolvedValue({
        session_id: 'session-002',
        user_id: 'user-001',
      })

      const req = {
        session: { userId: 'user-001', sessionId: 'session-001' },
      } as any

      const result = await controller.revokeSession('session-002', req)

      expect(mockSessionService.revokeSession).toHaveBeenCalledWith('session-002')
      expect(result).toEqual({ message: 'Session revoked.' })
    })

    it('throws 404 when session does not exist', async () => {
      mockSessionService.getSessionById.mockResolvedValue(null)

      const req = {
        session: { userId: 'user-001', sessionId: 'session-001' },
      } as any

      await expect(
        controller.revokeSession('nonexistent', req),
      ).rejects.toThrow(HttpException)

      try {
        await controller.revokeSession('nonexistent', req)
      } catch (e: any) {
        expect(e.getStatus()).toBe(404)
      }
    })

    it('throws 404 when session belongs to another user (info-safe)', async () => {
      mockSessionService.getSessionById.mockResolvedValue({
        session_id: 'session-003',
        user_id: 'user-002',
      })

      const req = {
        session: { userId: 'user-001', sessionId: 'session-001' },
      } as any

      let thrown = false
      try {
        await controller.revokeSession('session-003', req)
      } catch (e: any) {
        thrown = true
        expect(e.getStatus()).toBe(404)
        // Should NOT reveal it's a different user's session
        expect(e.message).not.toContain('forbidden')
        expect(e.message).not.toContain('belongs')
      }
      expect(thrown).toBe(true)
      expect(mockSessionService.revokeSession).not.toHaveBeenCalled()
    })
  })

  // ────────────────────────────────────────────────────────────
  // revokeAllSessions
  // ────────────────────────────────────────────────────────────

  describe('revokeAllSessions', () => {
    it('revokes all other sessions when password is correct', async () => {
      mockSessionService.verifyUserPassword.mockResolvedValue(true)
      mockSessionService.getUserSessions.mockResolvedValue([
        { session_id: 'session-001' }, // current
        { session_id: 'session-002' },
        { session_id: 'session-003' },
      ])
      mockSessionService.revokeAllUserSessions.mockResolvedValue(undefined)

      const req = {
        session: { userId: 'user-001', sessionId: 'session-001' },
      } as any

      const result = await controller.revokeAllSessions(
        { password: 'correct-password' },
        req,
      )

      expect(mockSessionService.verifyUserPassword).toHaveBeenCalledWith(
        'user-001',
        'correct-password',
      )
      expect(mockSessionService.revokeAllUserSessions).toHaveBeenCalledWith(
        'user-001',
        'session-001',
      )
      expect(result).toEqual({
        message: 'All 2 other session(s) revoked.',
        revokedCount: 2,
      })
    })

    it('returns 0 count when there are no other sessions', async () => {
      mockSessionService.verifyUserPassword.mockResolvedValue(true)
      mockSessionService.getUserSessions.mockResolvedValue([
        { session_id: 'session-001' },
      ])

      const req = {
        session: { userId: 'user-001', sessionId: 'session-001' },
      } as any

      const result = await controller.revokeAllSessions(
        { password: 'correct-password' },
        req,
      )

      expect(result).toEqual({
        message: 'No other sessions to revoke.',
        revokedCount: 0,
      })
      expect(mockSessionService.revokeAllUserSessions).not.toHaveBeenCalled()
    })

    it('throws 422 when password is incorrect', async () => {
      mockSessionService.verifyUserPassword.mockResolvedValue(false)

      const req = {
        session: { userId: 'user-001', sessionId: 'session-001' },
      } as any

      try {
        await controller.revokeAllSessions(
          { password: 'wrong-password' },
          req,
        )
      } catch (e: any) {
        expect(e.getStatus()).toBe(422)
      }
    })

    it('throws 400 for invalid body', async () => {
      const req = {
        session: { userId: 'user-001', sessionId: 'session-001' },
      } as any

      try {
        await controller.revokeAllSessions({}, req)
      } catch (e: any) {
        expect(e.getStatus()).toBe(400)
      }
    })
  })
})