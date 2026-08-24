import { describe, it, expect, vi, beforeEach } from 'vitest'
import { ConfigCache, type ConfigCacheLogger, type CachedConfigEntry } from './config-cache.js'

type MockRedis = {
  get: ReturnType<typeof vi.fn>
  set: ReturnType<typeof vi.fn>
  setex: ReturnType<typeof vi.fn>
  del: ReturnType<typeof vi.fn>
  incr: ReturnType<typeof vi.fn>
  scanStream: ReturnType<typeof vi.fn>
  pipeline: ReturnType<typeof vi.fn>
}

function mockRedis(): MockRedis {
  return {
    get: vi.fn(),
    set: vi.fn(),
    setex: vi.fn(),
    del: vi.fn(),
    incr: vi.fn(),
    scanStream: vi.fn(),
    pipeline: vi.fn(),
  }
}

function mockLogger(): ConfigCacheLogger {
  return { warn: vi.fn(), error: vi.fn() }
}

const VAT_RATE_ROW = { value: 0.09, version: 1 }
const VAT_RATE_CACHED: CachedConfigEntry<number> = {
  value: 0.09,
  version: 1,
  cachedAtGlobalVersion: 5,
}
const MIN_PRICE_ROW = { value: 1000, version: 3 }
const MIN_PRICE_CACHED: CachedConfigEntry<number> = {
  value: 1000,
  version: 3,
  cachedAtGlobalVersion: 7,
}

describe('ConfigCache', () => {
  let redis: MockRedis
  let fetchFromDb: ReturnType<typeof vi.fn>
  let fetchGlobalVersion: ReturnType<typeof vi.fn>
  let logger: ConfigCacheLogger
  let cache: ConfigCache

  function createCache(overrides?: { redis?: any }): ConfigCache {
    return new ConfigCache(
      fetchFromDb as any,
      fetchGlobalVersion as any,
      overrides?.redis !== undefined ? overrides.redis : (redis as any),
      logger,
    )
  }

  beforeEach(() => {
    vi.clearAllMocks()
    redis = mockRedis()
    fetchFromDb = vi.fn()
    fetchGlobalVersion = vi.fn()
    logger = mockLogger()
    cache = createCache()
  })

  // -----------------------------------------------------------------------
  // get / getWithVersion — cache hit
  // -----------------------------------------------------------------------

  it('returns cached value on cache hit when global version matches', async () => {
    redis.get.mockResolvedValue(JSON.stringify(VAT_RATE_CACHED))
    fetchGlobalVersion.mockResolvedValue(5)

    const result = await cache.get<number>('vat_rate')

    expect(result).toBe(0.09)
    // Should not have hit PG
    expect(fetchFromDb).not.toHaveBeenCalled()
  })

  it('marks result as fresh on cache hit', async () => {
    redis.get.mockResolvedValue(JSON.stringify(VAT_RATE_CACHED))
    fetchGlobalVersion.mockResolvedValue(5)

    const result = await cache.getWithVersion<number>('vat_rate')

    expect(result).toEqual({ value: 0.09, fresh: true, version: 1 })
    expect(fetchFromDb).not.toHaveBeenCalled()
  })

  // -----------------------------------------------------------------------
  // get — cache miss (no entry in Redis)
  // -----------------------------------------------------------------------

  it('reads from PG on cache miss and populates Redis', async () => {
    redis.get.mockResolvedValue(null)
    fetchFromDb.mockResolvedValue(VAT_RATE_ROW)
    fetchGlobalVersion.mockResolvedValue(5)

    const result = await cache.get<number>('vat_rate')

    expect(result).toBe(0.09)
    expect(fetchFromDb).toHaveBeenCalledWith('vat_rate')
    expect(fetchGlobalVersion).toHaveBeenCalled()
    expect(redis.setex).toHaveBeenCalledWith(
      'config:entry:vat_rate',
      300,
      JSON.stringify(VAT_RATE_CACHED satisfies CachedConfigEntry),
    )
  })

  // -----------------------------------------------------------------------
  // get — staleness detection when global version advances
  // -----------------------------------------------------------------------

  it('re-reads from PG when global version has advanced', async () => {
    // Cached entry has cachedAtGlobalVersion=5
    redis.get.mockResolvedValue(JSON.stringify(VAT_RATE_CACHED))
    // Global version is now 7
    fetchGlobalVersion.mockResolvedValue(7)
    // PG returns updated row (version=2)
    fetchFromDb.mockResolvedValue({ value: 0.08, version: 2 })

    const result = await cache.get<number>('vat_rate')

    // Should have re-read from PG because cachedAtGlobalVersion (5) < current (7)
    expect(result).toBe(0.08)
    expect(fetchFromDb).toHaveBeenCalledWith('vat_rate')
    // Should repopulate cache with fresh cachedAtGlobalVersion
    expect(redis.setex).toHaveBeenCalledWith(
      'config:entry:vat_rate',
      300,
      JSON.stringify({
        value: 0.08,
        version: 2,
        cachedAtGlobalVersion: 7,
      } satisfies CachedConfigEntry),
    )
  })

  it('returns stale-mismatch result as non-fresh', async () => {
    redis.get.mockResolvedValue(JSON.stringify(VAT_RATE_CACHED))
    fetchGlobalVersion.mockResolvedValue(7)
    fetchFromDb.mockResolvedValue({ value: 0.08, version: 2 })

    const result = await cache.getWithVersion<number>('vat_rate')

    expect(result).toEqual({ value: 0.08, fresh: false, version: 2 })
  })

  // -----------------------------------------------------------------------
  // get — non-existent key
  // -----------------------------------------------------------------------

  it('returns null when key does not exist in PG', async () => {
    redis.get.mockResolvedValue(null)
    fetchFromDb.mockResolvedValue(null)

    const result = await cache.get('nonexistent')

    expect(result).toBeNull()
    // Should not try to cache null
    expect(redis.setex).not.toHaveBeenCalled()
  })

  it('returns null when key is cached but global version advanced and PG has no row', async () => {
    redis.get.mockResolvedValue(JSON.stringify(VAT_RATE_CACHED))
    fetchGlobalVersion.mockResolvedValue(7)
    fetchFromDb.mockResolvedValue(null)

    const result = await cache.getWithVersion('vat_rate')

    expect(result.value).toBeNull()
    expect(result.fresh).toBe(true)
    expect(result.version).toBeNull()
  })

  // -----------------------------------------------------------------------
  // get — redis=null (no Redis configured)
  // -----------------------------------------------------------------------

  it('always reads from PG when redis is null', async () => {
    cache = createCache({ redis: null })
    fetchFromDb.mockResolvedValue(VAT_RATE_ROW)

    const result = await cache.get<number>('vat_rate')

    expect(result).toBe(0.09)
    expect(fetchFromDb).toHaveBeenCalledWith('vat_rate')
  })

  it('does not attempt to cache when redis is null', async () => {
    cache = createCache({ redis: null })
    fetchFromDb.mockResolvedValue(VAT_RATE_ROW)

    await cache.get('vat_rate')

    // No redis.setex — nothing to call
    const redisMethods = [redis.setex, redis.set, redis.del]
    for (const m of redisMethods) {
      expect(m).not.toHaveBeenCalled()
    }
  })

  // -----------------------------------------------------------------------
  // get — Redis failure (transparent fallback)
  // -----------------------------------------------------------------------

  it('falls back to PG when Redis get throws', async () => {
    redis.get.mockRejectedValue(new Error('Redis connection lost'))
    fetchFromDb.mockResolvedValue(VAT_RATE_ROW)

    const result = await cache.get<number>('vat_rate')

    expect(result).toBe(0.09)
    expect(fetchFromDb).toHaveBeenCalledWith('vat_rate')
    // Warning should be logged
    expect(logger.warn).toHaveBeenCalledWith(
      '[config-cache] Redis read failed, falling back to PostgreSQL:',
      'Redis connection lost',
    )
  })

  it('falls back to PG when Redis write throws (non-fatal)', async () => {
    redis.get.mockResolvedValue(null)
    fetchFromDb.mockResolvedValue(VAT_RATE_ROW)
    fetchGlobalVersion.mockResolvedValue(5)
    redis.setex.mockRejectedValue(new Error('Write error'))

    const result = await cache.get<number>('vat_rate')

    expect(result).toBe(0.09)
    expect(logger.warn).toHaveBeenCalledWith(
      '[config-cache] Redis write failed (non-fatal):',
      'Write error',
    )
  })

  // -----------------------------------------------------------------------
  // get — global version key expired/missing (fallback chain)
  // -----------------------------------------------------------------------

  it('re-reads from PG when global version key is missing (fetchGlobalVersion falls back to PG then returns > 0)', async () => {
    // Cache entry exists but global version advanced (e.g. key expired in Redis)
    redis.get.mockResolvedValue(JSON.stringify(VAT_RATE_CACHED))
    // fetchGlobalVersion's PG fallback returns a higher version
    fetchGlobalVersion.mockResolvedValue(10)
    fetchFromDb.mockResolvedValue({ value: 0.07, version: 2 })

    const result = await cache.get<number>('vat_rate')

    expect(result).toBe(0.07)
    expect(fetchFromDb).toHaveBeenCalled()
  })

  it('serves cached entry when fetchGlobalVersion returns >= cachedAtGlobalVersion', async () => {
    redis.get.mockResolvedValue(JSON.stringify(VAT_RATE_CACHED))
    // fetchGlobalVersion returns same value as cachedAtGlobalVersion
    fetchGlobalVersion.mockResolvedValue(5)

    const result = await cache.get<number>('vat_rate')

    expect(result).toBe(0.09)
    expect(fetchFromDb).not.toHaveBeenCalled()
  })

  // -----------------------------------------------------------------------
  // invalidate
  // -----------------------------------------------------------------------

  it('deletes cache entry and bumps global version on invalidate', async () => {
    redis.del.mockResolvedValue(1)
    redis.incr.mockResolvedValue(6)

    await cache.invalidate('vat_rate')

    expect(redis.del).toHaveBeenCalledWith('config:entry:vat_rate')
    expect(redis.incr).toHaveBeenCalledWith('config:global:version')
  })

  it('does nothing on invalidate when redis is null', async () => {
    cache = createCache({ redis: null })

    await cache.invalidate('vat_rate')

    expect(redis.del).not.toHaveBeenCalled()
    expect(redis.incr).not.toHaveBeenCalled()
  })

  it('logs warning when invalidate Redis call fails', async () => {
    redis.del.mockRejectedValue(new Error('OOM'))

    await cache.invalidate('vat_rate')

    expect(logger.warn).toHaveBeenCalledWith(
      '[config-cache] Redis invalidation failed (non-fatal):',
      'OOM',
    )
  })

  // -----------------------------------------------------------------------
  // invalidateAll
  // -----------------------------------------------------------------------

  it('scans all config entries and deletes them with pipeline', async () => {
    const mockStream = {
      async *[Symbol.asyncIterator]() {
        yield ['config:entry:vat_rate', 'config:entry:min_price']
        yield [] // second batch is empty
      },
    }
    redis.scanStream.mockReturnValue(mockStream)
    const mockPipeline = { del: vi.fn(), incr: vi.fn(), exec: vi.fn().mockResolvedValue([]) }
    redis.pipeline.mockReturnValue(mockPipeline)

    await cache.invalidateAll()

    expect(redis.scanStream).toHaveBeenCalledWith({
      match: 'config:entry:*',
      count: 100,
    })
    expect(mockPipeline.del).toHaveBeenCalledWith('config:entry:vat_rate', 'config:entry:min_price')
    expect(mockPipeline.incr).toHaveBeenCalledWith('config:global:version')
    expect(mockPipeline.exec).toHaveBeenCalled()
  })

  it('scans with empty results only bumps version', async () => {
    const mockStream = {
      async *[Symbol.asyncIterator]() {
        yield []
      },
    }
    redis.scanStream.mockReturnValue(mockStream)
    const mockPipeline = { del: vi.fn(), incr: vi.fn(), exec: vi.fn().mockResolvedValue([]) }
    redis.pipeline.mockReturnValue(mockPipeline)

    await cache.invalidateAll()

    expect(mockPipeline.del).not.toHaveBeenCalled()
    expect(mockPipeline.incr).toHaveBeenCalledWith('config:global:version')
    expect(mockPipeline.exec).toHaveBeenCalled()
  })

  // -----------------------------------------------------------------------
  // peek
  // -----------------------------------------------------------------------

  it('returns cached entry when present and fresh', async () => {
    redis.get.mockResolvedValue(JSON.stringify(VAT_RATE_CACHED))
    fetchGlobalVersion.mockResolvedValue(5)

    const result = await cache.peek<number>('vat_rate')

    expect(result).toEqual(VAT_RATE_CACHED)
  })

  it('returns null when cached entry is stale', async () => {
    redis.get.mockResolvedValue(JSON.stringify(VAT_RATE_CACHED))
    fetchGlobalVersion.mockResolvedValue(10)

    const result = await cache.peek<number>('vat_rate')

    expect(result).toBeNull()
  })

  it('returns null when entry is not in cache', async () => {
    redis.get.mockResolvedValue(null)

    const result = await cache.peek('nonexistent')

    expect(result).toBeNull()
  })

  it('returns null when redis is null', async () => {
    cache = createCache({ redis: null })

    const result = await cache.peek('vat_rate')

    expect(result).toBeNull()
  })

  it('returns null when Redis get throws', async () => {
    redis.get.mockRejectedValue(new Error('timeout'))

    const result = await cache.peek('vat_rate')

    expect(result).toBeNull()
    // No error/warning should be logged for peek — it's silent
    expect(logger.warn).not.toHaveBeenCalled()
    expect(logger.error).not.toHaveBeenCalled()
  })

  // -----------------------------------------------------------------------
  // Type safety — the config-cache is called with generic type parameter
  // -----------------------------------------------------------------------

  it('works with object values', async () => {
    const themeCached: CachedConfigEntry<{ primary: string }> = {
      value: { primary: '#00ff00' },
      version: 2,
      cachedAtGlobalVersion: 3,
    }
    redis.get.mockResolvedValue(JSON.stringify(themeCached))
    fetchGlobalVersion.mockResolvedValue(3)

    const result = await cache.get<{ primary: string }>('theme')

    expect(result).toEqual({ primary: '#00ff00' })
  })
})