import { describe, it, expect, vi, beforeEach } from 'vitest'
import { ForbiddenException } from '@nestjs/common'
import { ProfileVerifiedGuard } from './profiles.guard.js'
import { ProfilesService } from './profiles.service.js'

function createMockContext(options: { session?: any }) {
  const { session } = options

  return {
    switchToHttp: () => ({
      getRequest: () => ({
        ...(session ? { session } : {}),
      }),
    }),
    getHandler: () => () => {},
    getClass: () => ({}),
  } as any
}

describe('ProfileVerifiedGuard', () => {
  let guard: ProfileVerifiedGuard
  let mockProfilesService: ProfilesService

  beforeEach(() => {
    mockProfilesService = {
      canPlaceCommercialOrder: vi.fn(),
    } as unknown as ProfilesService

    guard = new ProfileVerifiedGuard(mockProfilesService)
  })

  describe('when no authenticated session', () => {
    it('rejects with FORBIDDEN', async () => {
      const context = createMockContext({})

      await expect(guard.canActivate(context)).rejects.toThrow(ForbiddenException)
    })
  })

  describe('when session is present', () => {
    it('allows when canPlaceCommercialOrder returns true', async () => {
      vi.mocked(mockProfilesService.canPlaceCommercialOrder).mockResolvedValue(true)

      const context = createMockContext({
        session: {
          sessionId: 'sid-1',
          userId: 'user-1',
          csrfToken: 'abc',
          isAdmin: false,
          stepUpVerifiedAt: null,
        },
      })

      const result = await guard.canActivate(context)
      expect(result).toBe(true)
      expect(mockProfilesService.canPlaceCommercialOrder).toHaveBeenCalledWith('user-1')
    })

    it('rejects with FORBIDDEN when canPlaceCommercialOrder returns false', async () => {
      vi.mocked(mockProfilesService.canPlaceCommercialOrder).mockResolvedValue(false)

      const context = createMockContext({
        session: {
          sessionId: 'sid-1',
          userId: 'user-1',
          csrfToken: 'abc',
          isAdmin: false,
          stepUpVerifiedAt: null,
        },
      })

      await expect(guard.canActivate(context)).rejects.toThrow(ForbiddenException)
      expect(mockProfilesService.canPlaceCommercialOrder).toHaveBeenCalledWith('user-1')
    })
  })
})