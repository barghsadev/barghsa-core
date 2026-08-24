import { Global, Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { RateLimitService } from './rate-limit.service.js';
import { RateLimitGuard } from './rate-limit.guard.js';

/**
 * Rate-limiting module for the Barghsa API.
 *
 * Provides:
 * - `RateLimitService` — injectable service for programmatic rate-limit checks
 * - `RateLimitGuard` — NestJS guard that enforces limits based on the
 *   `@RateLimit()` decorator
 *
 * The guard is registered as a global guard but only activates for routes
 * that carry the `@RateLimit()` decorator — routes without it are allowed
 * through without inspection.
 *
 * Import this module in `AppModule` to enable rate-limiting across the API.
 */
@Global()
@Module({
  providers: [
    RateLimitService,
    RateLimitGuard,
    {
      // Register the guard globally — it's a no-op for routes without
      // the @RateLimit() decorator.
      provide: APP_GUARD,
      useClass: RateLimitGuard,
    },
  ],
  exports: [RateLimitService, RateLimitGuard],
})
export class RateLimitModule {};