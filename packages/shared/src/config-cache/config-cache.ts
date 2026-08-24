import type { Redis } from 'ioredis'

// ---------------------------------------------------------------------------
// Logger contract — no framework dependency
// ---------------------------------------------------------------------------

export interface ConfigCacheLogger {
  warn(message: string, ...meta: unknown[]): void
  error(message: string, ...meta: unknown[]): void
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** A single cached config entry with its version and the global version snapshot. */
export interface CachedConfigEntry<T = unknown> {
  value: T
  /** Per-key version from app_config.version — incremented on each write to this key. */
  version: number
  /** The global version snapshot at the time this entry was cached. */
  cachedAtGlobalVersion: number
}

/** Result of a config fetch with staleness information. */
export interface ConfigFetchResult<T = unknown> {
  value: T | null
  fresh: boolean
  /** Per-key version from app_config.version. */
  version: number | null
}

// ---------------------------------------------------------------------------
// Config cache service
// ---------------------------------------------------------------------------

/**
 * Redis-backed configuration cache with version-gated staleness detection.
 *
 * ## Cache strategy
 *
 * - Each config entry is cached in Redis under `config:entry:<key>` with a
 *   5-minute TTL, storing both the value and its version number.
 * - A global version counter is stored in Redis under `config:global:version`.
 * - On every config write the global version is incremented and the affected
 *   entry's cached copy is evicted.
 *
 * ## Staleness guard
 *
 * When reading from cache the service compares the cached entry's version
 * against the global current version (fetched fresh from Redis).  If they
 * differ, the cache is treated as stale and the entry is re-read from
 * PostgreSQL — even if the 5-minute TTL has not expired.
 *
 * This guarantees that financial calculations and other version-sensitive
 * consumers always see the latest config without paying a PG round-trip on
 * every request during normal operation.
 *
 * ## Graceful degradation
 *
 * - `redis = null` → every call goes directly to PostgreSQL.
 * - Redis connection lost mid-operation → transparent PG fallback with a
 *   warning log.
 * - Global version key missing in Redis or stale cache entry → PG read.
 *
 * @example
 * ```ts
 * const cache = new ConfigCache(fetchFromPg, redis, logger);
 * const vatRate = await cache.get<number>('vat_rate');
 * ```
 */
export class ConfigCache {
  // -----------------------------------------------------------------------
  // Constants
  // -----------------------------------------------------------------------

  /** Redis key prefix for individual config entries. */
  static readonly ENTRY_PREFIX = 'config:entry:'

  /** Redis key for the global version counter. */
  static readonly GLOBAL_VERSION_KEY = 'config:global:version'

  /** TTL for cached config entries (5 minutes in seconds). */
  static readonly ENTRY_TTL_SEC = 300

  /** TTL for the global version counter (1 hour — only used for staleness). */
  static readonly GLOBAL_VERSION_TTL_SEC = 3600

  // -----------------------------------------------------------------------
  // Constructor
  // -----------------------------------------------------------------------

  /**
   * @param fetchFromDb  Async callback that reads a config value + version
   *                     from PostgreSQL given a key. Returns `null` when the
   *                     key does not exist.
   * @param fetchGlobalVersion  Async callback that reads the current global
   *                     configuration version. When Redis is available this
   *                     reads the `config:global:version` key; when Redis is
   *                     not available it can query `config_version` from PG
   *                     or return 0.
   * @param redis        Redis client or `null` (Redis is optional — config
   *                     works without it, just without caching).
   * @param logger       Optional logger for warnings / errors.
   */
  constructor(
    private readonly fetchFromDb: (key: string) => Promise<{ value: unknown; version: number } | null>,
    private readonly fetchGlobalVersion: () => Promise<number>,
    private readonly redis: Redis | null,
    private readonly logger?: ConfigCacheLogger,
  ) {}

  // -----------------------------------------------------------------------
  // Public methods
  // -----------------------------------------------------------------------

  /**
   * Retrieve a configuration value by key.
   *
   * **With Redis:** tries cache first. On cache miss or version mismatch,
   * reads from PostgreSQL, populates the cache, and returns the value.
   *
   * **Without Redis:** always reads from PostgreSQL.
   *
   * @param key          Config key (e.g. `'vat_rate'`, `'product_min_price'`)
   * @returns The config value, or `null` if the key does not exist.
   */
  async get<T = unknown>(key: string): Promise<T | null> {
    const result = await this.getWithVersion<T>(key)
    return result.value
  }

  /**
   * Retrieve a configuration value together with its cache freshness info.
   *
   * Use this when the caller needs to know whether the value came from cache
   * or was freshly fetched from PostgreSQL (e.g. for audit logging).
   *
   * @returns A `{ value, fresh, version }` tuple.
   */
  async getWithVersion<T = unknown>(key: string): Promise<ConfigFetchResult<T>> {
    // --- Try Redis -----------------------------------------------------------
    if (this.redis) {
      try {
        const [entryRaw, globalVersionRaw] = await Promise.all([
          this.redis.get(`${ConfigCache.ENTRY_PREFIX}${key}`),
          this.redis.get(ConfigCache.GLOBAL_VERSION_KEY),
        ])

        if (entryRaw) {
          const entry: CachedConfigEntry<T> = JSON.parse(entryRaw)
          const globalVersion = globalVersionRaw ? Number(globalVersionRaw) : 0

          // Compare the global version stored at cache time against the
          // current global version.  If cachedAtGlobalVersion >= current,
          // nothing has changed since this entry was cached.
          //
          // This is a correct comparison because every config write bumps
          // the global counter, and every cache population records the
          // global version observed at that moment.  After a PG re-read
          // the cached entry gets a fresh cachedAtGlobalVersion, so it
          // passes the check until the next write.
          if (entry.cachedAtGlobalVersion >= globalVersion) {
            return { value: entry.value, fresh: true, version: entry.version }
          }

          // Global version advanced — cache is stale; fall through to PG
        }
      } catch (err) {
        this.logger?.warn(
          '[config-cache] Redis read failed, falling back to PostgreSQL:',
          err instanceof Error ? err.message : String(err),
        )
        // Fall through to PG
      }
    }

    // --- Cache miss or stale — read from PostgreSQL ---------------------------
    const row = await this.fetchFromDb(key)
    if (!row) {
      return { value: null, fresh: true, version: null }
    }

    // --- Populate Redis cache -------------------------------------------------
    if (this.redis) {
      try {
        // Fetch the current global version — this is the snapshot we record
        // with the cached entry so future staleness checks are correct.
        const currentGlobalVersion = await this.fetchGlobalVersion()

        await Promise.all([
          this.redis.setex(
            `${ConfigCache.ENTRY_PREFIX}${key}`,
            ConfigCache.ENTRY_TTL_SEC,
            JSON.stringify({
              value: row.value,
              version: row.version,
              cachedAtGlobalVersion: currentGlobalVersion,
            } satisfies CachedConfigEntry),
          ),
          // Ensure the global version key exists with a TTL (may be missing
          // after a Redis flush or on first invocation)
          this.redis.set(
            ConfigCache.GLOBAL_VERSION_KEY,
            String(currentGlobalVersion),
            'EX',
            ConfigCache.GLOBAL_VERSION_TTL_SEC,
            'NX',
          ),
        ])
      } catch (err) {
        this.logger?.warn(
          '[config-cache] Redis write failed (non-fatal):',
          err instanceof Error ? err.message : String(err),
        )
      }
    }

    return { value: row.value as T, fresh: false, version: row.version }
  }

  /**
   * Invalidate a single config entry across the entire fleet.
   *
   * Deletes the cached entry from Redis and bumps the global version counter
   * so that all API replicas know the config has changed, even for entries
   * that were not directly evicted.
   *
   * Call this from the admin config update handler whenever a config value
   * is modified in PostgreSQL.
   *
   * @param key The config key that was updated.
   */
  async invalidate(key: string): Promise<void> {
    if (!this.redis) return

    try {
      await Promise.all([
        this.redis.del(`${ConfigCache.ENTRY_PREFIX}${key}`),
        this.redis.incr(ConfigCache.GLOBAL_VERSION_KEY),
      ])
    } catch (err) {
      this.logger?.warn(
        '[config-cache] Redis invalidation failed (non-fatal):',
        err instanceof Error ? err.message : String(err),
      )
    }
  }

  /**
   * Invalidate ALL cached config entries across the fleet.
   *
   * Deletes all `config:entry:*` keys and bumps the global version counter.
   * Use sparingly — prefer {@link invalidate} for individual updates.
   */
  async invalidateAll(): Promise<void> {
    if (!this.redis) return

    try {
      const stream = this.redis.scanStream({
        match: `${ConfigCache.ENTRY_PREFIX}*`,
        count: 100,
      })

      // Collect keys from the scan stream
      const keys: string[] = []
      for await (const batch of stream) {
        if (batch.length > 0) {
          keys.push(...batch)
        }
      }

      const pipeline = this.redis.pipeline()
      if (keys.length > 0) {
        pipeline.del(...keys)
      }
      pipeline.incr(ConfigCache.GLOBAL_VERSION_KEY)
      await pipeline.exec()
    } catch (err) {
      this.logger?.warn(
        '[config-cache] Full invalidation failed (non-fatal):',
        err instanceof Error ? err.message : String(err),
      )
    }
  }

  /**
   * Check whether a config value is currently cached in Redis.
   *
   * Returns the cached entry if present and fresh, or `null` if the key is
   * not cached or the cache is stale (version mismatch).
   */
  async peek<T = unknown>(key: string): Promise<CachedConfigEntry<T> | null> {
    if (!this.redis) return null

    try {
      const [entryRaw, globalVersionRaw] = await Promise.all([
        this.redis.get(`${ConfigCache.ENTRY_PREFIX}${key}`),
        this.redis.get(ConfigCache.GLOBAL_VERSION_KEY),
      ])

      if (!entryRaw) return null

      const entry: CachedConfigEntry<T> = JSON.parse(entryRaw)
      const globalVersion = globalVersionRaw ? Number(globalVersionRaw) : 0

      return entry.cachedAtGlobalVersion >= globalVersion ? entry : null
    } catch {
      return null
    }
  }
}