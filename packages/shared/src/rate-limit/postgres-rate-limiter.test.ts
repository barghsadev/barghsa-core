import { describe, it, expect, vi, beforeEach } from 'vitest';
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

  describe('increment', () => {
    it('returns allowed=true when under the limit', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [{ count: 1 }] });

      const result = await store.increment('api:127.0.0.1', 100, 60_000);

      expect(result.allowed).toBe(true);
      expect(result.remaining).toBe(99);
      expect(result.limit).toBe(100);
      expect(result.resetMs).toBeGreaterThanOrEqual(0);
      expect(result.resetMs).toBeLessThanOrEqual(60_000);
    });

    it('returns allowed=false when over the limit', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [{ count: 101 }] });

      const result = await store.increment('api:127.0.0.1', 100, 60_000);

      expect(result.allowed).toBe(false);
      expect(result.remaining).toBe(0);
    });

    it('calls PostgreSQL with upsert SQL', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [{ count: 1 }] });

      await store.increment('otp:+989123456789', 5, 300_000);

      const call = mockQuery.mock.calls[0];
      const query = call?.[0] as string | undefined;
      const params = call?.[1] as unknown[] | undefined;
      expect(query).toBeDefined();
      expect(query).toContain('INSERT INTO rate_limit_counters');
      expect(query).toContain('ON CONFLICT');
      expect(params?.[0]).toBe('otp:+989123456789');
      expect(params?.[2]).toBe(300_000);
    });
  });

  describe('incrementSecurity', () => {
    it('uses the security_rate_limit_counters table', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [{ count: 1 }] });

      await store.incrementSecurity('login:admin@example.com', 5, 300_000);

      const call = mockQuery.mock.calls[0];
      const query = call?.[0] as string | undefined;
      const params = call?.[1] as unknown[] | undefined;
      expect(query).toBeDefined();
      expect(query).toContain('INSERT INTO security_rate_limit_counters');
      expect(query).toContain('ON CONFLICT');
      expect(params?.[0]).toBe('login:admin@example.com');
    });

    it('returns correct remaining for security counters', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [{ count: 3 }] });

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
      expect(query).toContain('DELETE FROM rate_limit_counters');
      expect(query).toContain('WHERE key = $1');
      expect(query).not.toContain('window_start');
      expect(params?.[0]).toBe('api:127.0.0.1');
    });
  });

  describe('resetSecurity', () => {
    it('deletes from security_rate_limit_counters', async () => {
      mockQuery.mockResolvedValueOnce({ rowCount: 1 });

      await store.resetSecurity('otp:+989123456789');

      const call = mockQuery.mock.calls[0];
      const query = call?.[0] as string | undefined;
      expect(query).toBeDefined();
      expect(query).toContain('DELETE FROM security_rate_limit_counters');
    });
  });

  describe('cleanup', () => {
    it('deletes expired rows from both tables', async () => {
      mockQuery.mockResolvedValueOnce({ rowCount: 5 });
      mockQuery.mockResolvedValueOnce({ rowCount: 2 });

      const total = await store.cleanup();

      expect(total).toBe(7);
      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining('cleaned up 7 expired rows'),
      );
    });

    it('returns 0 when no rows to clean', async () => {
      mockQuery.mockResolvedValueOnce({ rowCount: 0 });
      mockQuery.mockResolvedValueOnce({ rowCount: 0 });

      const total = await store.cleanup();

      expect(total).toBe(0);
      expect(logger.warn).not.toHaveBeenCalled();
    });
  });
});