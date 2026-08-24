import {
  Injectable,
  type CanActivate,
  type ExecutionContext,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { rateLimitKey } from '@barghsa/shared/rate-limit';
import { RateLimitService } from './rate-limit.service.js';
import { RATE_LIMIT_KEY, type RateLimitOptions } from './rate-limit.decorator.js';

/**
 * NestJS guard that enforces rate limits using the CompositeRateLimiterStore.
 *
 * Configuration is provided via the `@RateLimit()` decorator on each
 * route handler or controller class.  If a route has no `@RateLimit()`
 * decorator, the guard allows the request through (no limit applied).
 *
 * The guard retrieves the `RateLimitService` from the NestJS application
 * context at activation time, supporting both global and local guard
 * registration.
 */
@Injectable()
export class RateLimitGuard implements CanActivate {
  private readonly logger = new Logger(RateLimitGuard.name);

  constructor(
    private readonly reflector: Reflector,
    private readonly rateLimitService: RateLimitService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    // Read the rate-limit config from the handler (method) or controller (class)
    const config: RateLimitOptions | undefined =
      this.reflector.get<RateLimitOptions>(RATE_LIMIT_KEY, context.getHandler()) ??
      this.reflector.get<RateLimitOptions>(RATE_LIMIT_KEY, context.getClass());

    // No rate-limit configured for this route — allow
    if (!config) {
      return true;
    }

    const request = context.switchToHttp().getRequest();
    const ip = request.ip ?? request.connection?.remoteAddress ?? 'unknown';

    // Build key: namespace:ip
    const key = rateLimitKey(config.namespace, ip);

    this.logger.debug(`Rate-limit check: ${key} (${config.limit}/${config.windowMs}ms)`);

    const result = config.security
      ? await this.rateLimitService.checkSecurityRateLimit(key, config.limit, config.windowMs)
      : await this.rateLimitService.checkRateLimit(key, config.limit, config.windowMs);

    if (!result.allowed) {
      this.logger.warn(`Rate limit exceeded: ${key} (${result.limit}/${config.windowMs}ms)`);

      throw new HttpException(
        {
          statusCode: HttpStatus.TOO_MANY_REQUESTS,
          error: 'Too Many Requests',
          message: 'Rate limit exceeded. Please try again later.',
          retryAfterMs: result.resetMs,
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    return true;
  }
}