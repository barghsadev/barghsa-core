import { describe, it, expect, vi, beforeEach } from 'vitest'
import { ForbiddenException } from '@nestjs/common'
import { CsrfGuard, SkipCsrf } from './csrf.guard.js'
import { correlationIdStorage } from '../common/correlation-id.middleware.js'

/**
 * Create a mock ExecutionContext for testing CSRF validation.
 *
 * @param options.method - HTTP method (default: 'POST')
 * @param options.session - Session data or undefined for unauthenticated
 * @param options.csrfHeader - Value of X-CSRF-Token header or undefined
 * @param options.skipCsrf - Whether the handler has @SkipCsrf() decorator
 */
function createMockContext(options: {
  method?: string
  session?: { sessionId: string; csrfToken: string; userId: string; isAdmin: boolean }
  csrfHeader?: string
  skipCsrf?: boolean
}) {
  const { method = 'POST', session, csrfHeader, skipCsrf = false } = options

  const handler = () => {}
  if (skipCsrf) {
    Reflect.defineMetadata('skipCsrf', true, handler)
  }

  return {
    switchToHttp: () => ({
      getRequest: () => ({
        method,
        headers: {
          'x-csrf-token': csrfHeader,
          ...(session ? {} : {}),
        },
        ...(session ? { session } : {}),
      }),
    }),
    getHandler: () => handler,
  } as unknown as any
}

describe('CsrfGuard', () => {
  let guard: CsrfGuard

  beforeEach(() => {
    guard = new CsrfGuard()
  })

  describe('safe methods (GET, HEAD, OPTIONS)', () => {
    it('allows GET requests without CSRF header', () => {
      const context = createMockContext({
        method: 'GET',
        session: { sessionId: 'sid-1', csrfToken: 'abc123', userId: 'user-1', isAdmin: false },
      })

      expect(guard.canActivate(context)).toBe(true)
    })

    it('allows HEAD requests without CSRF header', () => {
      const context = createMockContext({
        method: 'HEAD',
        session: { sessionId: 'sid-1', csrfToken: 'abc123', userId: 'user-1', isAdmin: false },
      })

      expect(guard.canActivate(context)).toBe(true)
    })

    it('allows OPTIONS requests without CSRF header', () => {
      const context = createMockContext({
        method: 'OPTIONS',
        session: { sessionId: 'sid-1', csrfToken: 'abc123', userId: 'user-1', isAdmin: false },
      })

      expect(guard.canActivate(context)).toBe(true)
    })
  })

  describe('unauthenticated requests (no session)', () => {
    it('allows POST without session (public endpoints like login)', () => {
      const context = createMockContext({
        method: 'POST',
        // No session — unauthenticated
      })

      expect(guard.canActivate(context)).toBe(true)
    })

    it('allows PUT without session', () => {
      const context = createMockContext({
        method: 'PUT',
      })

      expect(guard.canActivate(context)).toBe(true)
    })

    it('allows DELETE without session', () => {
      const context = createMockContext({
        method: 'DELETE',
      })

      expect(guard.canActivate(context)).toBe(true)
    })

    it('allows PATCH without session', () => {
      const context = createMockContext({
        method: 'PATCH',
      })

      expect(guard.canActivate(context)).toBe(true)
    })
  })

  describe('state-changing methods with session', () => {
    it('allows POST with valid CSRF token', () => {
      const context = createMockContext({
        method: 'POST',
        session: { sessionId: 'sid-1', csrfToken: 'valid-token', userId: 'user-1', isAdmin: false },
        csrfHeader: 'valid-token',
      })

      expect(guard.canActivate(context)).toBe(true)
    })

    it('allows PUT with valid CSRF token', () => {
      const context = createMockContext({
        method: 'PUT',
        session: { sessionId: 'sid-1', csrfToken: 'valid-token', userId: 'user-1', isAdmin: false },
        csrfHeader: 'valid-token',
      })

      expect(guard.canActivate(context)).toBe(true)
    })

    it('allows DELETE with valid CSRF token', () => {
      const context = createMockContext({
        method: 'DELETE',
        session: { sessionId: 'sid-1', csrfToken: 'valid-token', userId: 'user-1', isAdmin: false },
        csrfHeader: 'valid-token',
      })

      expect(guard.canActivate(context)).toBe(true)
    })

    it('allows PATCH with valid CSRF token', () => {
      const context = createMockContext({
        method: 'PATCH',
        session: { sessionId: 'sid-1', csrfToken: 'valid-token', userId: 'user-1', isAdmin: false },
        csrfHeader: 'valid-token',
      })

      expect(guard.canActivate(context)).toBe(true)
    })

    it('rejects POST with missing CSRF header', () => {
      const context = createMockContext({
        method: 'POST',
        session: { sessionId: 'sid-1', csrfToken: 'valid-token', userId: 'user-1', isAdmin: false },
        // No CSRF header
      })

      expect(() => guard.canActivate(context)).toThrow(ForbiddenException)
    })

    it('rejects POST with empty CSRF header', () => {
      const context = createMockContext({
        method: 'POST',
        session: { sessionId: 'sid-1', csrfToken: 'valid-token', userId: 'user-1', isAdmin: false },
        csrfHeader: '',
      })

      expect(() => guard.canActivate(context)).toThrow(ForbiddenException)
    })

    it('rejects POST with mismatched CSRF token', () => {
      const context = createMockContext({
        method: 'POST',
        session: { sessionId: 'sid-1', csrfToken: 'session-token-value', userId: 'user-1', isAdmin: false },
        csrfHeader: 'different-token',
      })

      expect(() => guard.canActivate(context)).toThrow(ForbiddenException)
    })

    it('returns 403 Forbidden on CSRF mismatch', () => {
      const context = createMockContext({
        method: 'POST',
        session: { sessionId: 'sid-1', csrfToken: 'session-token-value', userId: 'user-1', isAdmin: false },
        csrfHeader: 'wrong-token',
      })

      try {
        guard.canActivate(context)
        expect.unreachable('Should have thrown')
      } catch (e: unknown) {
        expect(e).toBeInstanceOf(ForbiddenException)
        const fe = e as ForbiddenException
        expect(fe.getStatus()).toBe(403)
        const response = fe.getResponse() as Record<string, unknown>
        expect(response.error).toBe('AUTHZ:CSRF_TOKEN_INVALID')
      }
    })
  })

  describe('SkipCsrf decorator', () => {
    it('bypasses CSRF check when @SkipCsrf() is present', () => {
      const context = createMockContext({
        method: 'POST',
        session: { sessionId: 'sid-1', csrfToken: 'valid-token', userId: 'user-1', isAdmin: false },
        // No CSRF header
        skipCsrf: true,
      })

      expect(guard.canActivate(context)).toBe(true)
    })
  })
})
