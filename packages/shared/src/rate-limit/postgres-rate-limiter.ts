import type { RateLimitResult, RateLimiterStore, RateLimitLogger } from './types.js';

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const CLEANUP_THRESHOLD_HOURS = 24;
const CLEANUP_INTERVAL_MS = 60 * 60 * 1000; // once an hour is enough

/**
 * Query function type — accepts SQL string and params, returns rows.
 * This abstraction avoids coupling the store to a specific pool implementation.
 */
export type DbQueryFn = (
  text: string,
  params?: unknown[],
) => Promise<{ rows: Record<string, unknown>[]; rowCount?: number | null }>;

/**
 * PostgreSQL-backed rate-limiter store.
 *
 * Uses `INSERT ... ON CONFLICT` on a compound primary key of
 * `(key, window_start)` to atomically upsert the counter for each
 * sliding window.  This design is safe under concurrent access because
 * the unique constraint serialises the upsert — a concurrent transaction
 * that inserts the same (key, window_start) will either update the
 * existing row or wait for the first to commit and then re-check.
 *
 * This store is also the authoritative backing for security-critical
 * counters (OTP, login, password-reset) that must survive a Redis flush.
 */
export class PostgresRateLimiterStore implements RateLimiterStore {
  private cleanupTimer: ReturnType<typeof setInterval> | null = null;
  private logger: RateLimitLogger;
  private query: DbQueryFn;

  constructor(query: DbQueryFn, logger?: RateLimitLogger) {
    this.query = query;
    this.logger = logger ?? {
      warn: () => undefined,
      error: () => undefined,
    };
  }

  // -----------------------------------------------------------------------
  // Lifecycle
  // -----------------------------------------------------------------------

  /**
   * Start periodic cleanup of expired rate-limit rows.
   * Should be called once at application startup.
   */
  startCleanup(): void {
    if (this.cleanupTimer) return;
    this.cleanupTimer = setInterval(() => {
      this.cleanup().catch((err) => {
        this.logger?.error('[PostgresRateLimiter] cleanup failed', err);
      });
    }, CLEANUP_INTERVAL_MS);
    // Unref so the timer does not keep the process alive
    if (typeof this.cleanupTimer === 'object' && 'unref' in this.cleanupTimer) {
      (this.cleanupTimer as NodeJS.Timeout).unref();
    }
  }

  /**
   * Stop periodic cleanup.
   */
  stopCleanup(): void {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
    }
  }

  // -----------------------------------------------------------------------
  // RateLimiterStore
  // -----------------------------------------------------------------------

  /**
   * Increment the counter for `key` within a window of `windowMs`.
   *
   * The sliding window is aligned to the current epoch millis modulo
   * `windowMs`, giving a fixed window.  This is an approximation of a
   * true sliding window but is safe and fast with PostgreSQL upserts.
   */
  async increment(
    key: string,
    limit: number,
    windowMs: number,
  ): Promise<RateLimitResult> {
    const now = Date.now();
    const windowStart = Math.floor(now / windowMs) * windowMs;
    const windowEnd = windowStart + windowMs;

    const result = await this.query(
      `INSERT INTO rate_limit_counters (key, window_start, window_ms, count)
       VALUES ($1, $2, $3, 1)
       ON CONFLICT (key, window_start) DO UPDATE
         SET count = rate_limit_counters.count + 1,
             updated_at = NOW()
       RETURNING count`,
      [key, windowStart, windowMs],
    );

    const row = result.rows[0];
    const count = row ? Number(row.count) : 1;
    const allowed = count <= limit;
    const resetMs = Math.max(0, windowEnd - now);

    return {
      allowed,
      remaining: Math.max(0, limit - count),
      limit,
      resetMs,
    };
  }

  /**
   * Manual reset — deletes the current window's counter for `key`.
   */
  async reset(key: string): Promise<void> {
    const now = Date.now();
    const windowStart = Math.floor(now / 60_000) * 60_000; // 1-minute granularity

    await this.query(
      `DELETE FROM rate_limit_counters WHERE key = $1 AND window_start >= $2`,
      [key, windowStart],
    );
  }

  /**
   * Increment a security-critical counter (OTP, login, password reset).
   */
  async incrementSecurity(
    key: string,
    limit: number,
    windowMs: number,
  ): Promise<RateLimitResult> {
    const now = Date.now();
    const windowStart = Math.floor(now / windowMs) * windowMs;
    const windowEnd = windowStart + windowMs;

    const result = await this.query(
      `INSERT INTO security_rate_limit_counters (key, window_start, window_ms, count)
       VALUES ($1, $2, $3, 1)
       ON CONFLICT (key, window_start) DO UPDATE
         SET count = security_rate_limit_counters.count + 1,
             updated_at = NOW()
       RETURNING count`,
      [key, windowStart, windowMs],
    );

    const row = result.rows[0];
    const count = row ? Number(row.count) : 1;
    const allowed = count <= limit;
    const resetMs = Math.max(0, windowEnd - now);

    return {
      allowed,
      remaining: Math.max(0, limit - count),
      limit,
      resetMs,
    };
  }

  /**
   * Reset a security-critical counter by key.
   */
  async resetSecurity(key: string): Promise<void> {
    const now = Date.now();
    const windowStart = Math.floor(now / 60_000) * 60_000;

    await this.query(
      `DELETE FROM security_rate_limit_counters WHERE key = $1 AND window_start >= $2`,
      [key, windowStart],
    );
  }

  // -----------------------------------------------------------------------
  // Maintenance
  // -----------------------------------------------------------------------

  /**
   * Remove rows whose window has fully expired.
   * Called automatically on a timer; can also be called manually.
   */
  async cleanup(): Promise<number> {
    const cutoff = Date.now() - CLEANUP_THRESHOLD_HOURS * 60 * 60 * 1000;

    const mainResult = await this.query(
      `DELETE FROM rate_limit_counters
       WHERE window_start + window_ms * 1000 < $1`,
      [cutoff],
    );

    const secResult = await this.query(
      `DELETE FROM security_rate_limit_counters
       WHERE window_start + window_ms * 1000 < $1`,
      [cutoff],
    );

    const total = Number(mainResult.rowCount ?? 0) + Number(secResult.rowCount ?? 0);
    if (total > 0) {
      this.logger?.warn(`[PostgresRateLimiter] cleaned up ${total} expired rows`);
    }
    return total;
  }
}