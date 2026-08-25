import { describe, it, expect, vi, beforeEach } from 'vitest'
import { UnauthorizedException } from '@nestjs/common'
import { SessionAuthGuard, SessionOptionalGuard } from './session.guard.js'
import { SessionService } from './session.service.js'

function createMockExecutionContext(cookie?: string) {
  return {
    switchToHttp: () => ({
      getRequest: () => ({
        cookies: cookie ? { barghsa_session: cookie } : {},
      }),
    }),
  } as unknown as any
}

describe('SessionAuthGuard', () => {
  describe('canActivate', () => {
    it('rejects requests without a session cookie', async () => {
      const mockSessionService = {
        validateSession: vi.fn(),
      } as unknown as SessionService

      const guard = new SessionAuthGuard(mockSessionService)
      const context = createMockExecutionContext()

      await expect(guard.canActivate(context)).rejects.toThrow(UnauthorizedException)
      expect(mockSessionService.validateSession).not.toHaveBeenCalled()
    })
  })
})

describe('SessionOptionalGuard', () => {
  describe('canActivate', () => {
    it('allows requests without a session cookie', async () => {
      const mockSessionService = {
        validateSession: vi.fn(),
      } as unknown as SessionService

      const guard = new SessionOptionalGuard(mockSessionService)
      const context = createMockExecutionContext()

      const result = await guard.canActivate(context)
      expect(result).toBe(true)
      expect(mockSessionService.validateSession).not.toHaveBeenCalled()
    })
  })
})