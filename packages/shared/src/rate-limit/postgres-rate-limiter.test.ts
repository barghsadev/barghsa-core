import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { DbQueryFn } from './postgres-rate-limiter.js';
import { PostgresRateLimiterStore } from './postgres-rate-limiter.js';

describe('PostgresRateLimiterStore', () => {
  let store: PostgresRateLimiterStore;
  let mockQuery: ReturnType<typeof vi.fn>;
  const logger = { warn: vi.fn(), error: vi.fn() };

  beforeEach(() => {
    vi.clearAllMocks();
    mockQuery = vi.fn();
    store = new PostgresRateLimiterStore(mockQuery as unknown as DbQueryFn, logger);
  });

  afterEach(() => {
    store.stopCleanup();
    vi.useRealTimers();
  });

  describe.each(['increment', 'incrementSecurity'] as const)('%s database response', (method) => {
    it('rejects a missing committed counter', async () => {
      mockQuery.mockResolvedValue({ rows: [] });
      await expect(store[method]('key', 5, 60_000)).rejects.toThrow('counter');
    });

    it.each([
      undefined,
      null,
      '',
      ' ',
      'no',
      false,
      -1,
      0,
      1.5,
      NaN,
      Infinity,
      Number.MAX_SAFE_INTEGER + 1,
      {},
      '1e2',
      '0x10',
    ])('rejects invalid count %s', async (count) => {
      mockQuery.mockResolvedValue({ rows: [{ reset_ms: 1000, count }] });
      await expect(store[method]('key', 5, 60_000)).rejects.toThrow('counter');
    });

    it('accepts the decimal string returned by a bigint parser', async () => {
      mockQuery.mockResolvedValue({ rows: [{ reset_ms: 1000, count: '6' }] });
      await expect(store[method]('key', 5, 60_000)).resolves.toMatchObject({
        allowed: false,
        remaining: 0,
      });
    });
  });

  describe('peek', () => {
    it('accepts an explicit empty history and rejects a missing result', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [] });
      await expect(store.getCurrentCount('key', 60_000)).rejects.toThrow('counter');
      mockQuery.mockResolvedValueOnce({ rows: [{ count: 0, reset_ms: 0 }] });
      await expect(store.getCurrentCount('key', 60_000)).resolves.toBe(0);
      mockQuery.mockResolvedValueOnce({ rows: [{ reset_ms: 1000, count: null }] });
      await expect(store.getCurrentCount('key', 60_000)).rejects.toThrow('counter');
      mockQuery.mockResolvedValueOnce({ rows: [{ reset_ms: 1000, count: '3' }] });
      await expect(store.getCurrentCount('key', 60_000)).resolves.toBe(3);
    });
  });

  describe('cleanup lifecycle', () => {
    it('starts once, stops idempotently, and can restart', async () => {
      vi.useFakeTimers();
      mockQuery.mockResolvedValue({ rows: [], rowCount: 0 });
      store.startCleanup();
      store.startCleanup();
      await vi.advanceTimersByTimeAsync(3_600_000);
      expect(mockQuery).toHaveBeenCalledTimes(3);
      store.stopCleanup();
      store.stopCleanup();
      await vi.advanceTimersByTimeAsync(3_600_000);
      expect(mockQuery).toHaveBeenCalledTimes(3);
      store.startCleanup();
      await vi.advanceTimersByTimeAsync(3_600_000);
      expect(mockQuery).toHaveBeenCalledTimes(6);
    });

    it('reports failure and retries on the next interval', async () => {
      vi.useFakeTimers();
      const error = new Error('database unavailable');
      mockQuery.mockRejectedValueOnce(error).mockResolvedValue({ rows: [], rowCount: 0 });
      store.startCleanup();
      await vi.advanceTimersByTimeAsync(3_600_000);
      expect(logger.error).toHaveBeenCalledWith('[PostgresRateLimiter] cleanup failed', error);
      await vi.advanceTimersByTimeAsync(3_600_000);
      expect(mockQuery).toHaveBeenCalledTimes(4);
    });
  });

  describe('increment', () => {
    it('returns allowed=true when under the limit', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [{ reset_ms: 1000, count: 1 }] });

      const result = await store.increment('api:127.0.0.1', 100, 60_000);

      expect(result.allowed).toBe(true);
      expect(result.remaining).toBe(99);
      expect(result.limit).toBe(100);
      expect(result.resetMs).toBeGreaterThanOrEqual(0);
      expect(result.resetMs).toBeLessThanOrEqual(60_000);
    });

    it('returns allowed=false when over the limit', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [{ reset_ms: 1000, count: 101 }] });

      const result = await store.increment('api:127.0.0.1', 100, 60_000);

      expect(result.allowed).toBe(false);
      expect(result.remaining).toBe(0);
    });

    it('calls PostgreSQL with upsert SQL', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [{ reset_ms: 1000, count: 1 }] });

      await store.increment('otp:+989123456789', 5, 300_000);

      const call = mockQuery.mock.calls[0];
      const query = call?.[0] as string | undefined;
      const params = call?.[1] as unknown[] | undefined;
      expect(query).toBeDefined();
      expect(query).toContain('rate_limit_rolling(');
      expect(params?.[0]).toBe(false);
      expect(params?.[1]).toBe('otp:+989123456789');
      expect(params?.[2]).toBe(300_000);
    });
  });

  describe('incrementSecurity', () => {
    it('uses the security_rate_limit_counters table', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [{ reset_ms: 1000, count: 1 }] });

      await store.incrementSecurity('login:admin@example.com', 5, 300_000);

      const call = mockQuery.mock.calls[0];
      const query = call?.[0] as string | undefined;
      const params = call?.[1] as unknown[] | undefined;
      expect(query).toBeDefined();
      expect(query).toContain('rate_limit_rolling(');
      expect(params?.[0]).toBe(true);
      expect(params?.[1]).toBe('login:admin@example.com');
    });

    it('returns correct remaining for security counters', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [{ reset_ms: 1000, count: 3 }] });

      const result = await store.incrementSecurity('login:admin@example.com', 5, 300_000);

      expect(result.allowed).toBe(true);
      expect(result.remaining).toBe(2);
      expect(result.limit).toBe(5);
    });
  });

  describe('reset', () => {
    it('deletes all rows for the given key', async () => {
      mockQuery.mockResolvedValueOnce({ rowCount: 1 });

      await store.reset('api:127.0.0.1');

      const call = mockQuery.mock.calls[0];
      const query = call?.[0] as string | undefined;
      const params = call?.[1] as unknown[] | undefined;
      expect(query).toBeDefined();
      expect(query).toContain('rate_limit_rolling_reset(');
      expect(params).toEqual([false, 'api:127.0.0.1']);
    });
  });

  describe('resetSecurity', () => {
    it('deletes from security_rate_limit_counters', async () => {
      mockQuery.mockResolvedValueOnce({ rowCount: 1 });

      await store.resetSecurity('otp:+989123456789');

      const call = mockQuery.mock.calls[0];
      const query = call?.[0] as string | undefined;
      expect(query).toBeDefined();
      expect(query).toContain('rate_limit_rolling_reset(');
      expect(call?.[1]).toEqual([true, 'otp:+989123456789']);
    });
  });

  describe('cleanup', () => {
    it('deletes expired rows from both tables', async () => {
      mockQuery.mockResolvedValueOnce({ rowCount: 0 });
      mockQuery.mockResolvedValueOnce({ rowCount: 5 });
      mockQuery.mockResolvedValueOnce({ rowCount: 2 });

      const total = await store.cleanup();

      expect(total).toBe(7);
      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining('cleaned up 7 expired rows')
      );
    });

    it('returns 0 when no rows to clean', async () => {
      mockQuery.mockResolvedValueOnce({ rowCount: 0 });
      mockQuery.mockResolvedValueOnce({ rowCount: 0 });
      mockQuery.mockResolvedValueOnce({ rowCount: 0 });

      const total = await store.cleanup();

      expect(total).toBe(0);
      expect(logger.warn).not.toHaveBeenCalled();
    });
  });
});
