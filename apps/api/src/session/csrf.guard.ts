import { PreauthCsrfService } from './preauth-csrf.service.js';
import {
  Inject,
  Injectable,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  UnauthorizedException,
  Logger,
} from '@nestjs/common';
import type { Request } from 'express';
import { ErrorCodes } from '@barghsa/shared/errors';
import { correlationIdStorage } from '../common/correlation-id.middleware.js';
import type { AuthenticatedRequest } from './session.guard.js';
import { SESSION_COOKIE_NAME } from './cookie.helper.js';

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
 * - Public auth requires JSON and a browser-bound anonymous or authenticated token.
 *   Signed provider callbacks and refresh use independent validation.
 *   Session-free requests must still satisfy their route's authentication.
 * - SessionContextMiddleware loads the session before this global guard runs.
 * - Failures return 403 with correlation ID and are logged as security events.
 *
 * Usage in a controller (applied globally via APP_GUARD):
 * ```ts
 * // No decorator needed — applied globally in SessionModule
 * async updateProfile(@Req() req: AuthenticatedRequest) { ... }
 * ```
 *
 * Public auth requires a token even before a user session exists:
 * ```ts
 * @RequirePreauthCsrf()
 * @Post('login')
 * ```
 */
@Injectable()
export class CsrfGuard implements CanActivate {
  private readonly logger = new Logger(CsrfGuard.name);

  /** HTTP methods that are exempt from CSRF checks (safe methods). */
  private readonly SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

  /** Name of the custom header carrying the CSRF token. */
  private readonly CSRF_HEADER = 'x-csrf-token';

  constructor(@Inject(PreauthCsrfService) private readonly preauth: PreauthCsrfService) {}

  canActivate(context: ExecutionContext): boolean | Promise<boolean> {
    const request: Request = context.switchToHttp().getRequest();
    const method = request.method.toUpperCase();

    // ── Safe methods are always allowed ─────────────────────────
    if (this.SAFE_METHODS.has(method)) {
      return true;
    }

    const handler = context.getHandler();
    const publicAuth = Reflect.getMetadata('preauthCsrf', handler);
    if (publicAuth) {
      if (!/^application\/json(?:\s*;|$)/i.test(request.headers['content-type'] ?? '')) {
        this.reject(method, 'public auth requires JSON');
      }
      if (!(request as AuthenticatedRequest).session) {
        const token = request.headers[this.CSRF_HEADER];
        if (typeof token !== 'string' || !token) this.reject(method, 'missing X-CSRF-Token header');
        return this.preauth
          .consume(request, context.switchToHttp().getResponse(), token)
          .then((valid) => {
            if (!valid) this.reject(method, 'anonymous token invalid or expired');
            return true;
          });
      }
    } else if (Reflect.getMetadata('skipCsrf', handler)) {
      // Refresh and signed callbacks enforce their independent request proofs.
      return true;
    }

    // ── No session → nothing to validate ────────────────────────
    const authRequest = request as AuthenticatedRequest;
    if (!authRequest.session) {
      if (request.cookies?.[SESSION_COOKIE_NAME]) {
        throw new UnauthorizedException({
          statusCode: 401,
          error: ErrorCodes.AUTH_UNAUTHENTICATED.code,
        });
      }
      return true;
    }

    // ── Validate the CSRF token header ──────────────────────────
    const headerToken = request.headers[this.CSRF_HEADER];
    const sessionToken = authRequest.session.csrfToken;

    if (!headerToken || typeof headerToken !== 'string') {
      this.reject(method, 'missing X-CSRF-Token header');
    }

    if (headerToken !== sessionToken) {
      this.reject(method, 'token mismatch');
    }

    return true;
  }

  private reject(method: string, reason: string): never {
    this.logger.warn(
      `CSRF check failed: ${reason} | method=${method} | ` +
        `correlationId=${correlationIdStorage.getStore() ?? 'none'}`
    );
    throw new ForbiddenException({ statusCode: 403, error: ErrorCodes.AUTHZ_CSRF_INVALID.code });
  }
}

/** Only independently authenticated refresh and signed provider callbacks may skip this guard. */
export function SkipCsrf(): MethodDecorator {
  return (_target, _propertyKey, descriptor) => {
    Reflect.defineMetadata('skipCsrf', true, descriptor!.value!);
  };
}

/** Public JSON authentication still requires a browser-bound token. */
export function RequirePreauthCsrf(): MethodDecorator {
  return (_target, _propertyKey, descriptor) => {
    Reflect.defineMetadata('preauthCsrf', true, descriptor!.value!);
  };
}
