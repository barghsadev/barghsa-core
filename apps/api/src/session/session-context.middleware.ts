import { Inject, Injectable, type NestMiddleware } from '@nestjs/common';
import type { Request, Response, NextFunction } from 'express';
import { parse } from 'cookie';
import { SessionService } from './session.service.js';
import { SESSION_COOKIE_NAME } from './cookie.helper.js';
import type { AuthenticatedRequest } from './session.guard.js';

/** Resolve cookie authentication before global guards make authorization decisions. */
@Injectable()
export class SessionContextMiddleware implements NestMiddleware {
  constructor(@Inject(SessionService) private readonly sessions: SessionService) {}

  async use(request: Request, _response: Response, next: NextFunction): Promise<void> {
    request.cookies = parse(request.headers.cookie ?? '');
    const sessionId = request.cookies[SESSION_COOKIE_NAME];
    if (typeof sessionId === 'string' && sessionId) {
      // A rejected CSRF request must not prolong the session's idle deadline.
      const session = await this.sessions.validateSession(sessionId, false);
      if (session) {
        (request as AuthenticatedRequest).session = {
          sessionId: session.sessionId,
          userId: session.userId,
          csrfToken: session.csrfToken,
          isAdmin: session.isAdmin,
          permissions: session.permissions ?? [],
          stepUpVerifiedAt: session.stepUpVerifiedAt,
        };
      }
    }
    next();
  }
}
