import { SetMetadata } from '@nestjs/common';

/**
 * Decorator arguments that configure rate-limiting for a controller or route.
 */
export interface RateLimitOptions {
  /** Namespace (e.g., 'api', 'endpoint', 'login'). */
  namespace: string;
  /** Maximum requests in the window. */
  limit: number;
  /** Window duration in milliseconds. */
  windowMs: number;
  /** If true, uses the PostgreSQL-authoritative path (security-critical). */
  security?: boolean;
}

export const RATE_LIMIT_KEY = 'rate_limit:config';

/**
 * Decorator to apply rate-limit configuration to a route handler or controller.
 *
 * Usage:
 * ```ts
 * @RateLimit({ namespace: 'api', limit: 100, windowMs: 60_000 })
 * @Get('users')
 * getUsers() { ... }
 * ```
 *
 * For security-critical endpoints:
 * ```ts
 * @RateLimit({ namespace: 'login', limit: 5, windowMs: 300_000, security: true })
 * @Post('login')
 * login() { ... }
 * ```
 */
export const RateLimit = (options: RateLimitOptions) => SetMetadata(RATE_LIMIT_KEY, options);