import {
  Injectable,
  type CanActivate,
  type ExecutionContext,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common'
import { Reflector } from '@nestjs/core'
import { rateLimitKey } from '@barghsa/shared/rate-limit'
import { ErrorCodes } from '@barghsa/shared/errors'
import { RateLimitService } from './rate-limit.service.js'
import { RATE_LIMIT_KEY, type RateLimitOptions } from './rate-limit.decorator.js'

/**
 * The human-readable key used to look up the rate-limit error message in
 * the i18n dictionary.  The frontend resolves this against the Accept-Language
 * header.
 */
const RATE_LIMIT_EXCEEDED_I18N_KEY = 'error.rate_limit.exceeded'

/**
 * NestJS guard that enforces rate limits using the CompositeRateLimiterStore.
 *
 * Configuration is provided via the `@RateLimit()` decorator on each
 * route handler or controller class.  If a route has no `@RateLimit()`
 * decorator, the guard allows the request through (no limit applied).
 *
 * The guard sets the `Retry-After` HTTP header on 429 responses so
 * intermediary proxies and well-behaved clients can respect the back-off.
 */
@Injectable()
export class RateLimitGuard implements CanActivate {
  private readonly logger = new Logger(RateLimitGuard.name)

  constructor(
    private readonly reflector: Reflector,
    private readonly rateLimitService: RateLimitService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    // Read the rate-limit config from the handler (method) or controller (class)
    const config: RateLimitOptions | undefined =
      this.reflector.get<RateLimitOptions>(RATE_LIMIT_KEY, context.getHandler()) ??
      this.reflector.get<RateLimitOptions>(RATE_LIMIT_KEY, context.getClass())

    // No rate-limit configured for this route — allow
    if (!config) {
      return true
    }

    const http = context.switchToHttp()
    const request = http.getRequest()
    const response = http.getResponse()
    const ip = request.ip ?? request.socket?.remoteAddress ?? 'unknown'

    // Build key: namespace:ip (or namespace:userId when available)
    const key = rateLimitKey(config.namespace, ip)

    this.logger.debug(`Rate-limit check: ${key} (${config.limit}/${config.windowMs}ms)`)

    const result = config.security
      ? await this.rateLimitService.checkSecurityRateLimit(key, config.limit, config.windowMs)
      : await this.rateLimitService.checkRateLimit(key, config.limit, config.windowMs)

    if (!result.allowed) {
      this.logger.warn(`Rate limit exceeded: ${key} (${result.limit}/${config.windowMs}ms)`)

      // Compute seconds remaining for Retry-After header
      const retryAfterSeconds = Math.ceil(result.resetMs / 1000)
      const retryAfterHeader = String(retryAfterSeconds)

      // Set Retry-After HTTP header (RFC 7231 §7.1.3)
      if (typeof response?.setHeader === 'function') {
        response.setHeader('Retry-After', retryAfterHeader)
      }

      throw new HttpException(
        {
          statusCode: HttpStatus.TOO_MANY_REQUESTS,
          error: ErrorCodes.RATE_LIMIT_EXCEEDED.code,
          message: RATE_LIMIT_EXCEEDED_I18N_KEY,
          retryAfterMs: result.resetMs,
          retryAfterSeconds: retryAfterSeconds,
          namespace: config.namespace,
        },
        HttpStatus.TOO_MANY_REQUESTS,
      )
    }

    return true
  }
}