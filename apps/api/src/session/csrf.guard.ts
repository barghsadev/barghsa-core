import {
  Injectable,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Logger,
} from '@nestjs/common'
import type { Request } from 'express'
import { ErrorCodes } from '@barghsa/shared/errors'
import { correlationIdStorage } from '../common/correlation-id.middleware.js'
import type { AuthenticatedRequest } from './session.guard.js'

/**
 * CSRF protection guard (T-02.02.03).
 *
 * Validates that every state-changing request (POST, PUT, PATCH, DELETE)
 * includes an `X-CSRF-Token` header matching the authenticated session's
 * stored CSRF token.
 *
 * The CSRF token is bound to the server-side session, rotated on auth
 * events (login, logout, password change, session rotation), and delivered
 * to the frontend via both the response body and a non-HttpOnly cookie
 * (`barghsa_csrf`) which the frontend reads and sends back as the header.
 *
 * Design notes:
 * - GET, HEAD, OPTIONS are exempt (safe methods per HTTP spec).
 * - Unauthenticated requests (no session) are exempt — CSRF requires a
 *   session to be meaningful. Auth endpoints that create sessions (login,
 *   register) are naturally exempt because they run before a session exists.
 * - This guard runs AFTER the SessionAuthGuard so `req.session` is populated.
 * - Failures return 403 with correlation ID and are logged as security events.
 *
 * Usage in a controller (applied globally via APP_GUARD):
 * ```ts
 * // No decorator needed — applied globally in SessionModule
 * async updateProfile(@Req() req: AuthenticatedRequest) { ... }
 * ```
 *
 * To skip CSRF on a specific controller method (rare — auth endpoints only):
 * ```ts
 * @SkipCsrf()
 * @Post('login')
 * ```
 */
@Injectable()
export class CsrfGuard implements CanActivate {
  private readonly logger = new Logger(CsrfGuard.name)

  /** HTTP methods that are exempt from CSRF checks (safe methods). */
  private readonly SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS'])

  /** Name of the custom header carrying the CSRF token. */
  private readonly CSRF_HEADER = 'x-csrf-token'

  canActivate(context: ExecutionContext): boolean {
    const request: Request = context.switchToHttp().getRequest()
    const method = request.method.toUpperCase()

    // ── Safe methods are always allowed ─────────────────────────
    if (this.SAFE_METHODS.has(method)) {
      return true
    }

    // ── Check if a skip decorator is present ────────────────────
    const handler = context.getHandler()
    const skipCsrf = Reflect.getMetadata('skipCsrf', handler)
    if (skipCsrf) {
      return true
    }

    // ── No session → nothing to validate ────────────────────────
    const authRequest = request as AuthenticatedRequest
    if (!authRequest.session) {
      return true
    }

    // ── Validate the CSRF token header ──────────────────────────
    const headerToken = request.headers[this.CSRF_HEADER]
    const sessionToken = authRequest.session.csrfToken

    if (!headerToken || typeof headerToken !== 'string') {
      const correlationId = correlationIdStorage.getStore()
      this.logger.warn(
        `CSRF check failed: missing X-CSRF-Token header | ` +
        `session=${authRequest.session.sessionId} | ` +
        `method=${method} | correlationId=${correlationId ?? 'none'}`,
      )
      throw new ForbiddenException({
        statusCode: 403,
        error: ErrorCodes.AUTHZ_CSRF_INVALID.code,
      })
    }

    if (headerToken !== sessionToken) {
      const correlationId = correlationIdStorage.getStore()
      this.logger.warn(
        `CSRF check failed: token mismatch | ` +
        `session=${authRequest.session.sessionId} | ` +
        `method=${method} | correlationId=${correlationId ?? 'none'}`,
      )
      throw new ForbiddenException({
        statusCode: 403,
        error: ErrorCodes.AUTHZ_CSRF_INVALID.code,
      })
    }

    return true
  }
}

/**
 * Decorator to skip CSRF validation on a specific route handler.
 *
 * Use ONLY on auth endpoints that establish or destroy a session
 * (login, register, logout) where a CSRF token cannot exist yet.
 *
 * ```ts
 * @SkipCsrf()
 * @Post('login')
 * async login(@Body() body: LoginDto) { ... }
 * ```
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function SkipCsrf(): MethodDecorator {
  return (
    _target: object,
    _propertyKey: string | symbol,
    descriptor: TypedPropertyDescriptor<any>,
  ) => {
    Reflect.defineMetadata('skipCsrf', true, descriptor.value!)
    return descriptor
  }
}
