import { describe, it, expect, vi, beforeEach } from 'vitest'
import { ForbiddenException } from '@nestjs/common'
import { Reflector } from '@nestjs/core'
import { StepUpGuard, RequiresStepUp } from './step-up.guard.js'

/**
 * Create a mock ExecutionContext for testing step-up validation.
 */
function createMockContext(options: {
  method?: string
  session?: any
  requiresStepUp?: boolean
}) {
  const { method = 'POST', session, requiresStepUp = false } = options

  const handler = () => {}
  if (requiresStepUp) {
    Reflect.defineMetadata('requiresStepUp', true, handler)
  }

  return {
    switchToHttp: () => ({
      getRequest: () => ({
        method,
        ...(session ? { session } : {}),
      }),
    }),
    getHandler: () => handler,
    getClass: () => ({}),
  } as unknown as any
}

describe('StepUpGuard', () => {
  let guard: StepUpGuard

  beforeEach(() => {
    guard = new StepUpGuard(new Reflector())
  })

  describe('no step-up required (no decorator)', () => {
    it('allows request without @RequiresStepUp() decorator', () => {
      const context = createMockContext({
        method: 'POST',
        session: {
          sessionId: 'sid-1',
          csrfToken: 'abc123',
          userId: 'user-1',
          isAdmin: false,
          stepUpVerifiedAt: null,
        },
        requiresStepUp: false,
      })

      expect(guard.canActivate(context)).toBe(true)
    })

    it('allows request even without session when no decorator', () => {
      const context = createMockContext({
        method: 'POST',
        requiresStepUp: false,
      })

      expect(guard.canActivate(context)).toBe(true)
    })
  })

  describe('step-up required, but never verified', () => {
    it('rejects when stepUpVerifiedAt is null', () => {
      const context = createMockContext({
        method: 'POST',
        session: {
          sessionId: 'sid-1',
          csrfToken: 'abc123',
          userId: 'user-1',
          isAdmin: false,
          stepUpVerifiedAt: null,
        },
        requiresStepUp: true,
      })

      try {
        guard.canActivate(context)
        expect.unreachable('Should have thrown')
      } catch (e: unknown) {
        expect(e).toBeInstanceOf(ForbiddenException)
        const fe = e as ForbiddenException
        expect(fe.getStatus()).toBe(403)
        const response = fe.getResponse() as Record<string, unknown>
        expect(response.error).toBe('AUTHZ:STEP_UP_REQUIRED')
      }
    })

    it('rejects when stepUpVerifiedAt is undefined', () => {
      const context = createMockContext({
        method: 'POST',
        session: {
          sessionId: 'sid-1',
          csrfToken: 'abc123',
          userId: 'user-1',
          isAdmin: false,
        },
        requiresStepUp: true,
      })

      try {
        guard.canActivate(context)
        expect.unreachable('Should have thrown')
      } catch (e: unknown) {
        expect(e).toBeInstanceOf(ForbiddenException)
        const response = (e as ForbiddenException).getResponse() as Record<string, unknown>
        expect(response.error).toBe('AUTHZ:STEP_UP_REQUIRED')
      }
    })

    it('rejects when no session at all', () => {
      const context = createMockContext({
        method: 'POST',
        requiresStepUp: true,
      })

      try {
        guard.canActivate(context)
        expect.unreachable('Should have thrown')
      } catch (e: unknown) {
        expect(e).toBeInstanceOf(ForbiddenException)
        const response = (e as ForbiddenException).getResponse() as Record<string, unknown>
        expect(response.error).toBe('AUTHZ:STEP_UP_REQUIRED')
      }
    })
  })

  describe('step-up required and verified', () => {
    it('allows request when step-up was just verified', () => {
      const context = createMockContext({
        method: 'POST',
        session: {
          sessionId: 'sid-1',
          csrfToken: 'abc123',
          userId: 'user-1',
          isAdmin: false,
          stepUpVerifiedAt: new Date(),
        },
        requiresStepUp: true,
      })

      expect(guard.canActivate(context)).toBe(true)
    })

    it('allows request when step-up was verified within the window (1 min ago)', () => {
      const oneMinuteAgo = new Date(Date.now() - 1 * 60 * 1000)
      const context = createMockContext({
        method: 'POST',
        session: {
          sessionId: 'sid-1',
          csrfToken: 'abc123',
          userId: 'user-1',
          isAdmin: false,
          stepUpVerifiedAt: oneMinuteAgo,
        },
        requiresStepUp: true,
      })

      expect(guard.canActivate(context)).toBe(true)
    })

    it('rejects when step-up window has expired (20 min ago)', () => {
      const twentyMinutesAgo = new Date(Date.now() - 20 * 60 * 1000)
      const context = createMockContext({
        method: 'POST',
        session: {
          sessionId: 'sid-1',
          csrfToken: 'abc123',
          userId: 'user-1',
          isAdmin: false,
          stepUpVerifiedAt: twentyMinutesAgo,
        },
        requiresStepUp: true,
      })

      try {
        guard.canActivate(context)
        expect.unreachable('Should have thrown')
      } catch (e: unknown) {
        expect(e).toBeInstanceOf(ForbiddenException)
        const response = (e as ForbiddenException).getResponse() as Record<string, unknown>
        expect(response.error).toBe('AUTHZ:STEP_UP_REQUIRED')
      }
    })
  })

  describe('RequiresStepUp decorator', () => {
    it('sets requiresStepUp metadata on the handler', () => {
      const handler = () => {}
      const decorated = RequiresStepUp() as (
        target: object,
        key: string | symbol,
        descriptor: PropertyDescriptor,
      ) => void

      const descriptor = { value: handler }
      decorated({}, 'testMethod', descriptor)

      expect(Reflect.getMetadata('requiresStepUp', handler)).toBe(true)
    })
  })
})
