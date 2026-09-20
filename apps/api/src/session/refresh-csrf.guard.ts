import {
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  type CanActivate,
  type ExecutionContext,
} from '@nestjs/common';
import type { Request } from 'express';
import { ErrorCodes } from '@barghsa/shared/errors';
import { correlationIdStorage } from '../common/correlation-id.middleware.js';
import { REFRESH_COOKIE_NAME } from './cookie.helper.js';
import { SessionService } from './session.service.js';

/** Require the CSRF token bound to the presented refresh credential. */
@Injectable()
export class RefreshCsrfGuard implements CanActivate {
  private readonly logger = new Logger(RefreshCsrfGuard.name);

  constructor(@Inject(SessionService) private readonly sessions: SessionService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request>();
    const refreshToken = request.cookies?.[REFRESH_COOKIE_NAME];
    const csrfToken = request.headers['x-csrf-token'];
    if (typeof refreshToken !== 'string' || !refreshToken) return true; // controller returns 401
    if (
      typeof csrfToken !== 'string' ||
      !csrfToken ||
      !(await this.sessions.validateRefreshCsrf(refreshToken, csrfToken))
    ) {
      this.logger.warn(
        `CSRF check failed: refresh token binding invalid | method=${request.method} | ` +
          `correlationId=${correlationIdStorage.getStore() ?? 'none'}`
      );
      throw new ForbiddenException({ statusCode: 403, error: ErrorCodes.AUTHZ_CSRF_INVALID.code });
    }
    return true;
  }
}
