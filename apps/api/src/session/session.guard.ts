import {
  Injectable,
  CanActivate,
  ExecutionContext,
  UnauthorizedException,
  Logger,
} from '@nestjs/common'
import type { Request } from 'express'
import { SessionService } from './session.service.js'
import { SESSION_COOKIE_NAME } from './cookie.helper.js'
import { ErrorCodes } from '@barghsa/shared/errors'

/**
 * Augmented Express Request with authenticated session data.
 */
export interface AuthenticatedRequest extends Request {
  session: {
    sessionId: string
    userId: string
    csrfToken: string
    isAdmin: boolean
    stepUpVerifiedAt: Date | null
  }
}

/**
 * Session authentication guard (T-02.02.01).
 *
 * Reads the session cookie from the request, validates it against
 * the database, and rejects unauthenticated, expired, or revoked
 * sessions with a 401 response.
 *
 * On success, attaches the validated session data to the request
 * object so downstream route handlers can access `req.session`.
 *
 * Usage in a controller:
 * ```ts
 * @UseGuards(SessionAuthGuard)
 * @Get('profile')
 * async getProfile(@Req() req: AuthenticatedRequest) { ... }
 * ```
 *
 * For optional authentication (routes that work with or without
 * a session), use SessionOptionalGuard instead.
 */
@Injectable()
export class SessionAuthGuard implements CanActivate {
  private readonly logger = new Logger(SessionAuthGuard.name)

  constructor(private readonly sessionService: SessionService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request: Request = context.switchToHttp().getRequest()

    const sessionId = request.cookies?.[SESSION_COOKIE_NAME]

    if (!sessionId || typeof sessionId !== 'string') {
      this.logger.debug('No session cookie found')
      throw new UnauthorizedException({
        statusCode: 401,
        error: ErrorCodes.AUTH_UNAUTHENTICATED.code,
      })
    }

    const validated = await this.sessionService.validateSession(sessionId)

    if (!validated) {
      this.logger.debug(`Session ${sessionId} invalid, expired, or revoked`)
      throw new UnauthorizedException({
        statusCode: 401,
        error: ErrorCodes.AUTH_UNAUTHENTICATED.code,
      })
    }

    // Attach session to request
    ;(request as AuthenticatedRequest).session = {
      sessionId: validated.sessionId,
      userId: validated.userId,
      csrfToken: validated.csrfToken,
      isAdmin: validated.isAdmin,
      stepUpVerifiedAt: validated.stepUpVerifiedAt,
    }

    return true
  }
}

/**
 * Optional session authentication guard.
 *
 * Like SessionAuthGuard but does not reject unauthenticated requests.
 * Use this on routes that work with or without an authenticated session.
 *
 * Example: public listings that show user-specific data when available.
 *
 * ```ts
 * @UseGuards(SessionOptionalGuard)
 * @Get('products')
 * async getProducts(@Req() req: AuthenticatedRequest | Request) {
 *   const userId = 'session' in req ? req.session.userId : undefined
 * }
 * ```
 */
@Injectable()
export class SessionOptionalGuard implements CanActivate {
  private readonly logger = new Logger(SessionOptionalGuard.name)

  constructor(private readonly sessionService: SessionService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request: Request = context.switchToHttp().getRequest()

    const sessionId = request.cookies?.[SESSION_COOKIE_NAME]

    if (!sessionId || typeof sessionId !== 'string') {
      // No session — that's fine for optional auth
      return true
    }

    const validated = await this.sessionService.validateSession(sessionId)

    if (validated) {
      ;(request as AuthenticatedRequest).session = {
        sessionId: validated.sessionId,
        userId: validated.userId,
        csrfToken: validated.csrfToken,
        isAdmin: validated.isAdmin,
        stepUpVerifiedAt: validated.stepUpVerifiedAt,
      }
    }

    return true
  }
}