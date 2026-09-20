import type { RateLimitResult, RateLimiterStore, RateLimitLogger } from './types.js';

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const CLEANUP_INTERVAL_MS = 60 * 60 * 1000; // once an hour is enough

/**
 * Query function type — accepts SQL string and params, returns rows.
 * This abstraction avoids coupling the store to a specific pool implementation.
 */
export type DbQueryFn = (
  text: string,
  params?: unknown[]
) => Promise<{ rows: Record<string, unknown>[]; rowCount?: number | null }>;

/** Reject missing or corrupt database results instead of granting quota. */
function readCounter(row: Record<string, unknown> | undefined): number {
  const raw = row?.count;
  const count =
    typeof raw === 'number'
      ? raw
      : typeof raw === 'string' && /^[1-9][0-9]*$/.test(raw)
        ? Number(raw)
        : NaN;
  if (!Number.isSafeInteger(count) || count < 1) {
    throw new Error('Invalid persisted rate-limit counter');
  }
  return count;
}

/** PostgreSQL serializes rolling histories, resets and reads per key.
 * Database time is authoritative; Redis loss cannot erase this history.
 * Histories retain quota + 1 attempts, enough to decide rolling admission.
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

  private async rolling(
    security: boolean,
    key: string,
    limit: number | null,
    windowMs: number,
    increment: boolean
  ): Promise<{ count: number; resetMs: number }> {
    const result = await this.query(
      'SELECT count, reset_ms FROM rate_limit_rolling($1, $2, $3, $4, $5)',
      [security, key, windowMs, limit, increment]
    );
    const row = result.rows[0];
    const count = !increment && (row?.count === 0 || row?.count === '0') ? 0 : readCounter(row);
    const raw = row?.reset_ms;
    const resetMs =
      typeof raw === 'number'
        ? raw
        : typeof raw === 'string' && /^[0-9]+$/.test(raw)
          ? Number(raw)
          : NaN;
    if (!Number.isSafeInteger(resetMs) || resetMs < 0)
      throw new Error('Invalid persisted rate-limit expiry');
    return { count, resetMs };
  }

  private async consume(
    security: boolean,
    key: string,
    limit: number,
    windowMs: number
  ): Promise<RateLimitResult> {
    const { count, resetMs } = await this.rolling(security, key, limit, windowMs, true);
    return { allowed: count <= limit, remaining: Math.max(0, limit - count), limit, resetMs };
  }

  async increment(key: string, limit: number, windowMs: number): Promise<RateLimitResult> {
    return this.consume(false, key, limit, windowMs);
  }

  async incrementSecurity(key: string, limit: number, windowMs: number): Promise<RateLimitResult> {
    return this.consume(true, key, limit, windowMs);
  }

  async getCurrentCount(key: string, windowMs: number): Promise<number> {
    return (await this.rolling(true, key, null, windowMs, false)).count;
  }

  async reset(key: string): Promise<void> {
    await this.query('SELECT rate_limit_rolling_reset($1, $2)', [false, key]);
  }

  async resetSecurity(key: string): Promise<void> {
    await this.query('SELECT rate_limit_rolling_reset($1, $2)', [true, key]);
  }

  // -----------------------------------------------------------------------
  // Maintenance
  // -----------------------------------------------------------------------

  /**
   * Remove rows whose window has fully expired.
   * Called automatically on a timer; can also be called manually.
   */
  async cleanup(): Promise<number> {
    const rollingResult = await this.query(
      `DELETE FROM rate_limit_windows
       WHERE expires_at < floor(extract(epoch FROM clock_timestamp()) * 1000) - 86400000`
    );
    const mainResult = await this.query(
      `DELETE FROM rate_limit_counters WHERE
       GREATEST(window_start + window_ms - 1, floor(extract(epoch FROM updated_at) * 1000)) + window_ms
       < floor(extract(epoch FROM clock_timestamp()) * 1000) - 86400000`
    );
    const secResult = await this.query(
      `DELETE FROM security_rate_limit_counters WHERE
       GREATEST(window_start + window_ms - 1, floor(extract(epoch FROM updated_at) * 1000)) + window_ms
       < floor(extract(epoch FROM clock_timestamp()) * 1000) - 86400000`
    );

    const total =
      Number(rollingResult.rowCount ?? 0) +
      Number(mainResult.rowCount ?? 0) +
      Number(secResult.rowCount ?? 0);
    if (total > 0) {
      this.logger?.warn(`[PostgresRateLimiter] cleaned up ${total} expired rows`);
    }
    return total;
  }
}
