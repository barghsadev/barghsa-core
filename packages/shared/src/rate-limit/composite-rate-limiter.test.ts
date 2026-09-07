import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { DbQueryFn } from './postgres-rate-limiter.js';
import { PostgresRateLimiterStore } from './postgres-rate-limiter.js';
import { CompositeRateLimiterStore } from './composite-rate-limiter.js';

function createMockRedis() {
  return { eval: vi.fn(), del: vi.fn(), setex: vi.fn() };
}

describe('CompositeRateLimiterStore', () => {
  let store: CompositeRateLimiterStore;
  let pgStore: PostgresRateLimiterStore;
  let mockQuery: ReturnType<typeof vi.fn>;
  let mockRedis: ReturnType<typeof createMockRedis>;
  const logger = { warn: vi.fn(), error: vi.fn() };

  beforeEach(() => {
    vi.clearAllMocks();
    mockQuery = vi.fn();
    mockRedis = createMockRedis();
    pgStore = new PostgresRateLimiterStore(mockQuery as unknown as DbQueryFn, logger);
    store = new CompositeRateLimiterStore(pgStore, mockRedis as unknown as null, logger);
  });

  describe('when Redis is available', () => {
    beforeEach(() => {
      store = new CompositeRateLimiterStore(pgStore, mockRedis as unknown as null, logger);
    });

    it('uses Redis for increment when Redis succeeds', async () => {
      mockRedis.eval.mockResolvedValue([1, 60_000]);

      const result = await store.increment('api:1.2.3.4', 100, 60_000);

      expect(mockRedis.eval).toHaveBeenCalledWith(expect.any(String), 1, 'api:1.2.3.4', 60_000);
      expect(mockQuery).not.toHaveBeenCalled(); // No PG fallback
      expect(result.allowed).toBe(true);
      expect(result.remaining).toBe(99);
    });

    it('falls back to PostgreSQL when Redis throws', async () => {
      mockRedis.eval.mockRejectedValue(new Error('ECONNREFUSED'));
      mockQuery.mockResolvedValueOnce({ rows: [{ count: 1 }] });

      const result = await store.increment('api:1.2.3.4', 100, 60_000);

      expect(mockRedis.eval).toHaveBeenCalled();
      expect(mockQuery).toHaveBeenCalled();
      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining('Redis increment failed'),
        expect.any(Error)
      );
      expect(result.allowed).toBe(true);
    });

    it.each([
      0,
      -1,
      1.5,
      Number.NaN,
      Number.POSITIVE_INFINITY,
      Number.MAX_SAFE_INTEGER + 1,
      '1',
      null,
    ])('falls back when Redis returns an invalid count %s', async (count) => {
      mockRedis.eval.mockResolvedValue([count, 30_000]);
      mockQuery.mockResolvedValueOnce({ rows: [{ count: 101 }] });

      const result = await store.increment('api:1.2.3.4', 100, 60_000);

      expect(result.allowed).toBe(false);
      expect(result.remaining).toBe(0);
      expect(mockQuery).toHaveBeenCalledOnce();
      expect(logger.warn).toHaveBeenCalledOnce();
    });

    it.each([
      -2,
      -1,
      -3,
      1.5,
      Number.NaN,
      Number.POSITIVE_INFINITY,
      Number.MAX_SAFE_INTEGER + 1,
      '30000',
      null,
    ])('falls back when Redis returns an invalid TTL %s', async (ttl) => {
      mockRedis.eval.mockResolvedValue([2, ttl]);
      mockQuery.mockResolvedValueOnce({ rows: [{ count: 101 }] });

      const result = await store.increment('api:1.2.3.4', 100, 60_000);

      expect(result.allowed).toBe(false);
      expect(result.remaining).toBe(0);
      expect(mockQuery).toHaveBeenCalledOnce();
      expect(logger.warn).toHaveBeenCalledOnce();
    });

    it.each([null, 1, [], [1], [1, 100, 200]])(
      'rejects malformed script reply %j',
      async (reply) => {
        mockRedis.eval.mockResolvedValue(reply);
        mockQuery.mockResolvedValueOnce({ rows: [{ count: 101 }] });
        expect((await store.increment('api:1.2.3.4', 100, 60_000)).allowed).toBe(false);
        expect(mockQuery).toHaveBeenCalledOnce();
      }
    );

    it('returns over-limit from Redis', async () => {
      mockRedis.eval.mockResolvedValue([101, 30_000]);

      const result = await store.increment('api:1.2.3.4', 100, 60_000);

      expect(result.allowed).toBe(false);
      expect(result.remaining).toBe(0);
      expect(result.resetMs).toBe(30_000);
    });
  });

  describe('when Redis is null', () => {
    beforeEach(() => {
      store = new CompositeRateLimiterStore(pgStore, null, logger);
    });

    it('goes directly to PostgreSQL for increment', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [{ count: 1 }] });

      const result = await store.increment('api:1.2.3.4', 100, 60_000);

      expect(mockQuery).toHaveBeenCalled();
      expect(result.allowed).toBe(true);
    });
  });

  describe('incrementSecurity', () => {
    it('writes to PostgreSQL first and mirrors to Redis', async () => {
      store = new CompositeRateLimiterStore(pgStore, mockRedis as unknown as null, logger);
      mockQuery.mockResolvedValueOnce({ rows: [{ count: 1 }] });
      mockRedis.setex.mockResolvedValue('OK');

      const result = await store.incrementSecurity('login:admin', 5, 300_000);

      // PG called first
      const pgCall = mockQuery.mock.calls[0];
      expect(pgCall?.[0]).toContain('INSERT INTO security_rate_limit_counters');
      // Redis mirror called
      expect(mockRedis.setex).toHaveBeenCalledWith(
        'security:login:admin',
        expect.any(Number),
        expect.any(String)
      );
      expect(result.allowed).toBe(true);
    });

    it('still works when Redis mirror fails', async () => {
      store = new CompositeRateLimiterStore(pgStore, mockRedis as unknown as null, logger);
      mockQuery.mockResolvedValueOnce({ rows: [{ count: 1 }] });
      mockRedis.setex.mockRejectedValue(new Error('Redis down'));

      const result = await store.incrementSecurity('login:admin', 5, 300_000);

      expect(result.allowed).toBe(true); // PG is authoritative
      // Should not log an error for non-critical Redis mirror failure
      expect(logger.error).not.toHaveBeenCalled();
    });

    it('does not mirror when Redis is null', async () => {
      store = new CompositeRateLimiterStore(pgStore, null, logger);
      mockQuery.mockResolvedValueOnce({ rows: [{ count: 1 }] });

      await store.incrementSecurity('login:admin', 5, 300_000);

      expect(mockQuery).toHaveBeenCalled();
    });
  });

  describe('reset', () => {
    it('deletes from both Redis and PostgreSQL', async () => {
      store = new CompositeRateLimiterStore(pgStore, mockRedis as unknown as null, logger);
      mockRedis.del.mockResolvedValue(1);
      mockQuery.mockResolvedValueOnce({ rowCount: 1 });

      await store.reset('api:1.2.3.4');

      expect(mockRedis.del).toHaveBeenCalledWith('api:1.2.3.4');
      const pgCall = mockQuery.mock.calls[0];
      expect(pgCall?.[0]).toContain('DELETE FROM rate_limit_counters');
    });

    it('skips Redis when redis is null', async () => {
      store = new CompositeRateLimiterStore(pgStore, null, logger);
      mockQuery.mockResolvedValueOnce({ rowCount: 1 });

      await store.reset('api:1.2.3.4');

      expect(mockQuery).toHaveBeenCalled();
    });
  });
});
