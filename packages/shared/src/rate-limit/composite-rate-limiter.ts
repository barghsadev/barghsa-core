import type { Redis } from 'ioredis';
import type { RateLimitResult, RateLimitLogger } from './types.js';
import { PostgresRateLimiterStore } from './postgres-rate-limiter.js';

/**
 * A rate-limiter store that tries Redis first and falls back to PostgreSQL.
 *
 * This is the primary high-level store used by the NestJS guard and
 * application code.  It wraps:
 *
 * 1. A **Redis store** (fast, ephemeral) — used when `redis` is available.
 * 2. A **PostgreSQL store** (durable, slower) — used as fallback when
 *    Redis is unavailable, and always used for security-critical counters.
 *
 * Redis loss NEVER allows an unbounded rate limit — the PostgreSQL store
 * always provides a safety net.
 */
export class CompositeRateLimiterStore {
  private pgStore: PostgresRateLimiterStore;
  private redis: Redis | null;
  private logger: RateLimitLogger;

  constructor(pgStore: PostgresRateLimiterStore, redis: Redis | null, logger?: RateLimitLogger) {
    this.pgStore = pgStore;
    this.redis = redis;
    this.logger = logger ?? {
      warn: () => undefined,
      error: () => undefined,
    };
  }

  /**
   * Increment a general rate-limit counter.
   *
   * Tries Redis first; falls back to PostgreSQL on any Redis error.
   */
  async increment(
    key: string,
    limit: number,
    windowMs: number,
  ): Promise<RateLimitResult> {
    if (this.redis) {
      try {
        return await this.incrementRedis(key, limit, windowMs);
      } catch (err) {
        this.logger?.warn(
          '[CompositeRateLimiter] Redis increment failed, falling back to PostgreSQL',
          err,
        );
      }
    }
    return this.pgStore.increment(key, limit, windowMs);
  }

  /**
   * Increment a security-critical rate-limit counter.
   *
   * Always writes to PostgreSQL (authoritative).  Optionally also updates
   * Redis for fast reads, but the PostgreSQL write always happens first.
   */
  async incrementSecurity(
    key: string,
    limit: number,
    windowMs: number,
  ): Promise<RateLimitResult> {
    // PostgreSQL first — it's the authoritative source for security counters
    const result = await this.pgStore.incrementSecurity(key, limit, windowMs);

    // Mirror to Redis for fast read path (best-effort)
    if (this.redis) {
      try {
        await this.setRedisCount(key, result.remaining, limit, windowMs);
      } catch {
        // Non-critical — PG is authoritative
      }
    }

    return result;
  }

  /**
   * Reset a general rate-limit counter.
   */
  async reset(key: string): Promise<void> {
    if (this.redis) {
      try {
        await this.redis.del(key);
      } catch {
        // Best-effort
      }
    }
    await this.pgStore.reset(key);
  }

  /**
   * Reset a security-critical counter.
   */
  async resetSecurity(key: string): Promise<void> {
    if (this.redis) {
      try {
        await this.redis.del(`security:${key}`);
      } catch {
        // Best-effort
      }
    }
    await this.pgStore.resetSecurity(key);
  }

  // -----------------------------------------------------------------------
  // Redis internals
  // -----------------------------------------------------------------------

  /**
   * Increment using Redis `INCR` + `EXPIRE`.
   * Returns the current count and window state.
   */
  private async incrementRedis(
    key: string,
    limit: number,
    windowMs: number,
  ): Promise<RateLimitResult> {
    const redis = this.redis!;
    const count = await redis.incr(key);
    let ttl = await redis.pttl(key);

    // First increment in a new window — set expiry
    if (count === 1 || ttl <= 0) {
      await redis.pexpire(key, windowMs);
      ttl = windowMs;
    }

    const allowed = count <= limit;

    return {
      allowed,
      remaining: Math.max(0, limit - count),
      limit,
      resetMs: Math.max(0, ttl),
    };
  }

  /**
   * Set a Redis key with an expiry after a security-counter increment.
   */
  private async setRedisCount(
    key: string,
    count: number,
    limit: number,
    windowMs: number,
  ): Promise<void> {
    const redisKey = `security:${key}`;
    await this.redis!.setex(redisKey, Math.ceil(windowMs / 1000), String(count));
  }
}