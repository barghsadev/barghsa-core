import type { Redis } from 'ioredis';
import type { RateLimitResult, RateLimitLogger } from './types.js';
import { PostgresRateLimiterStore } from './postgres-rate-limiter.js';

// Keep increment and expiry in one server operation. A client disconnect between
// separate commands must not leave a counter without an expiry.
const INCREMENT_WITH_EXPIRY = `
local count = redis.call('INCR', KEYS[1])
local ttl = redis.call('PTTL', KEYS[1])
if ttl < 0 then
  redis.call('PEXPIRE', KEYS[1], ARGV[1])
  ttl = tonumber(ARGV[1])
end
return {count, ttl}
`;

/**
 * PostgreSQL records every request before admission. Redis supplies an additional
 * fast counter, but losing or replacing it cannot erase the durable quota.
 * Database errors fail closed. Redis errors use the already-recorded result.
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
   * Persists first; Redis can further restrict admission, never grant extra quota.
   */
  async increment(key: string, limit: number, windowMs: number): Promise<RateLimitResult> {
    const durable = await this.pgStore.increment(key, limit, windowMs);
    if (this.redis) {
      try {
        const cached = await this.incrementRedis(key, limit, windowMs);
        return {
          allowed: durable.allowed && cached.allowed,
          remaining: Math.min(durable.remaining, cached.remaining),
          limit,
          resetMs:
            !durable.allowed && !cached.allowed
              ? Math.max(durable.resetMs, cached.resetMs)
              : !durable.allowed
                ? durable.resetMs
                : !cached.allowed
                  ? cached.resetMs
                  : Math.max(durable.resetMs, cached.resetMs),
        };
      } catch (err) {
        this.logger?.warn(
          '[CompositeRateLimiter] Redis increment failed, using persisted PostgreSQL quota',
          err
        );
      }
    }
    return durable;
  }

  /**
   * Increment a security-critical rate-limit counter.
   *
   * Always writes to PostgreSQL (authoritative).  Optionally also updates
   * Redis for fast reads, but the PostgreSQL write always happens first.
   */
  async incrementSecurity(key: string, limit: number, windowMs: number): Promise<RateLimitResult> {
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
   * Peek at the current count for `key` without incrementing.
   * Used by the progressive login delay in AuthService.
   */
  async getSecurityCount(key: string, windowMs: number): Promise<number> {
    return this.pgStore.getCurrentCount(key, windowMs);
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
   * Atomically increment and assign an expiry using a parameterized Redis script.
   * Returns the current count and window state.
   */
  private async incrementRedis(
    key: string,
    limit: number,
    windowMs: number
  ): Promise<RateLimitResult> {
    const redis = this.redis!;
    const reply: unknown = await redis.eval(INCREMENT_WITH_EXPIRY, 1, key, windowMs);
    if (!Array.isArray(reply) || reply.length !== 2) {
      throw new Error('Redis rate-limit reply is invalid');
    }
    const [count, ttl] = reply;
    if (typeof count !== 'number' || !Number.isSafeInteger(count) || count <= 0) {
      throw new Error('Redis rate-limit count is invalid');
    }
    if (typeof ttl !== 'number' || !Number.isSafeInteger(ttl) || ttl < 0) {
      throw new Error('Redis rate-limit TTL is invalid');
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
    windowMs: number
  ): Promise<void> {
    const redisKey = `security:${key}`;
    await this.redis!.setex(redisKey, Math.ceil(windowMs / 1000), String(count));
  }
}
