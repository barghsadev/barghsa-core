import { PostgresRateLimiterStore } from '@barghsa/shared/rate-limit';
import { CompositeRateLimiterStore } from '@barghsa/shared/rate-limit';
import { Inject, Injectable, Logger, Optional, type OnModuleDestroy } from '@nestjs/common';
import type { Redis } from 'ioredis';
import { getDbPool } from '@barghsa/db';
import { REDIS_CLIENT } from '../redis/index.js';

/**
 * Injectable wrapper around the CompositeRateLimiterStore.
 *
 * Provides the rate-limiter as a NestJS service so it can be injected
 * into guards, interceptors, and controllers.
 *
 * The PostgreSQL store uses the application's global db pool (lazily
 * initialised by `createDbPool()` in the bootstrap).  The Redis store
 * is only used when the REDIS_CLIENT token resolves to a non-null
 * Redis instance.
 */
@Injectable()
export class RateLimitService implements OnModuleDestroy {
  private readonly logger = new Logger(RateLimitService.name);
  private pgStore: PostgresRateLimiterStore | null = null;
  private compositeStore: CompositeRateLimiterStore | null = null;

  constructor(
    @Inject(REDIS_CLIENT)
    @Optional()
    private readonly redis: Redis | null,
  ) {}

  private ensureStores(): void {
    if (!this.pgStore) {
      const pool = getDbPool();
      this.pgStore = new PostgresRateLimiterStore(
        (text, params) => pool.query(text, params),
        {
          warn: (msg, ...meta) => this.logger.warn(msg, ...meta),
          error: (msg, ...meta) => this.logger.error(msg, ...meta),
        },
      );
      this.pgStore.startCleanup();
    }
    if (!this.compositeStore) {
      this.compositeStore = new CompositeRateLimiterStore(
        this.pgStore,
        this.redis,
        {
          warn: (msg, ...meta) => this.logger.warn(msg, ...meta),
          error: (msg, ...meta) => this.logger.error(msg, ...meta),
        },
      );
    }
  }

  /**
   * Check a general rate limit.
   */
  async checkRateLimit(
    key: string,
    limit: number,
    windowMs: number,
  ): ReturnType<CompositeRateLimiterStore['increment']> {
    this.ensureStores();
    return this.compositeStore!.increment(key, limit, windowMs);
  }

  /**
   * Check a security-critical rate limit (OTP, login, password reset).
   * Always backed by PostgreSQL as the authoritative source.
   */
  async checkSecurityRateLimit(
    key: string,
    limit: number,
    windowMs: number,
  ): ReturnType<CompositeRateLimiterStore['incrementSecurity']> {
    this.ensureStores();
    return this.compositeStore!.incrementSecurity(key, limit, windowMs);
  }

  /**
   * Reset a rate-limit counter (e.g., after successful login or OTP verification).
   */
  async resetRateLimit(key: string): Promise<void> {
    this.ensureStores();
    await this.compositeStore!.reset(key);
  }

  /**
   * Reset a security-critical rate-limit counter.
   */
  async resetSecurityRateLimit(key: string): Promise<void> {
    this.ensureStores();
    await this.compositeStore!.resetSecurity(key);
  }

  onModuleDestroy(): void {
    this.pgStore?.stopCleanup();
  }
}