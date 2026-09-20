import type { Redis } from 'ioredis';

// ---------------------------------------------------------------------------
// Logger contract — no framework dependency
// ---------------------------------------------------------------------------

export interface ConfigCacheLogger {
  warn(message: string, ...meta: unknown[]): void;
  error(message: string, ...meta: unknown[]): void;
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** A single cached config entry with its version and the global version snapshot. */
export interface CachedConfigEntry<T = unknown> {
  value: T;
  /** Per-key version from app_config.version — incremented on each write to this key. */
  version: number;
  /** The global version snapshot at the time this entry was cached. */
  cachedAtGlobalVersion: number;
}

/** Result of a config fetch with staleness information. */
export interface ConfigFetchResult<T = unknown> {
  value: T | null;
  fresh: boolean;
  /** Per-key version from app_config.version. */
  version: number | null;
}

// ---------------------------------------------------------------------------
// Config cache service
// ---------------------------------------------------------------------------

/**
 * Optional Redis cache. Freshness comes from a durable PostgreSQL version,
 * incremented in the same transaction as each configuration write.
 * Redis invalidation counters are hints, never proof that data is current.
 */
export class ConfigCache {
  // -----------------------------------------------------------------------
  // Constants
  // -----------------------------------------------------------------------

  /** New namespace excludes entries certified by the former racy version check. */
  static readonly ENTRY_PREFIX = 'config:entry:v2:';

  /** Redis key for the global version counter. */
  static readonly GLOBAL_VERSION_KEY = 'config:global:version';

  /** TTL for cached config entries (5 minutes in seconds). */
  static readonly ENTRY_TTL_SEC = 300;

  // -----------------------------------------------------------------------
  // Constructor
  // -----------------------------------------------------------------------

  /**
   * @param fetchFromDb  Async callback that reads a config value + version
   *                     from PostgreSQL given a key. Returns `null` when the
   *                     key does not exist.
   * @param fetchGlobalVersion Reads the authoritative committed version from
   * PostgreSQL. Must throw when unavailable; never substitute a Redis counter.
   * @param redis        Redis client or `null` (Redis is optional — config
   *                     works without it, just without caching).
   * @param logger       Optional logger for warnings / errors.
   */
  constructor(
    private readonly fetchFromDb: (
      key: string
    ) => Promise<{ value: unknown; version: number } | null>,
    private readonly fetchGlobalVersion: () => Promise<number>,
    private readonly redis: Redis | null,
    private readonly logger?: ConfigCacheLogger
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
    const result = await this.getWithVersion<T>(key);
    return result.value;
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
        const entryRaw = await this.redis.get(`${ConfigCache.ENTRY_PREFIX}${key}`);

        if (entryRaw) {
          const entry: CachedConfigEntry<T> = JSON.parse(entryRaw);
          const globalVersion = await this.fetchGlobalVersion();

          if (this.isFreshEntry(entry, globalVersion)) {
            return { value: entry.value, fresh: true, version: entry.version };
          }
        }
      } catch (err) {
        this.logger?.warn(
          '[config-cache] Redis read failed, falling back to PostgreSQL:',
          err instanceof Error ? err.message : String(err)
        );
        // Fall through to PG
      }
    }

    // --- Cache miss or stale — read from PostgreSQL ---------------------------
    // Read the version before the value. A later version cannot certify an
    // older row fetched before a concurrent configuration commit.
    let versionBefore: number | undefined;
    if (this.redis) {
      try {
        const version = await this.fetchGlobalVersion();
        if (Number.isSafeInteger(version) && version > 0) versionBefore = version;
      } catch {
        // Database reads can still succeed when version metadata is unavailable.
      }
    }
    const row = await this.fetchFromDb(key);
    if (!row) {
      return { value: null, fresh: true, version: null };
    }

    // --- Populate Redis cache -------------------------------------------------
    if (this.redis && versionBefore !== undefined) {
      try {
        // Fetch the current global version — this is the snapshot we record
        // with the cached entry so future staleness checks are correct.
        const currentGlobalVersion = await this.fetchGlobalVersion();

        if (currentGlobalVersion !== versionBefore) {
          return { value: row.value as T, fresh: false, version: row.version };
        }
        await this.redis.setex(
          `${ConfigCache.ENTRY_PREFIX}${key}`,
          ConfigCache.ENTRY_TTL_SEC,
          JSON.stringify({
            value: row.value,
            version: row.version,
            cachedAtGlobalVersion: currentGlobalVersion,
          } satisfies CachedConfigEntry)
        );
      } catch (err) {
        this.logger?.warn(
          '[config-cache] Redis write failed (non-fatal):',
          err instanceof Error ? err.message : String(err)
        );
      }
    }

    return { value: row.value as T, fresh: false, version: row.version };
  }

  /**
   * Invalidate a single config entry across the entire fleet.
   *
   * Evicts the entry and updates the legacy Redis invalidation hint. The
   * writer must also increment config_version in its PostgreSQL transaction;
   * cache correctness does not depend on this best-effort eviction.
   *
   * Call this from the admin config update handler whenever a config value
   * is modified in PostgreSQL.
   *
   * @param key The config key that was updated.
   */
  async invalidate(key: string): Promise<void> {
    if (!this.redis) return;

    try {
      await Promise.all([
        this.redis.del(`${ConfigCache.ENTRY_PREFIX}${key}`),
        this.redis.incr(ConfigCache.GLOBAL_VERSION_KEY),
      ]);
    } catch (err) {
      this.logger?.warn(
        '[config-cache] Redis invalidation failed (non-fatal):',
        err instanceof Error ? err.message : String(err)
      );
    }
  }

  /**
   * Invalidate ALL cached config entries across the fleet.
   *
   * Deletes current-namespace entries and bumps the Redis invalidation hint.
   * Use sparingly — prefer {@link invalidate} for individual updates.
   */
  async invalidateAll(): Promise<void> {
    if (!this.redis) return;

    try {
      const stream = this.redis.scanStream({
        match: `${ConfigCache.ENTRY_PREFIX}*`,
        count: 100,
      });

      // Collect keys from the scan stream
      const keys: string[] = [];
      for await (const batch of stream) {
        if (batch.length > 0) {
          keys.push(...batch);
        }
      }

      const pipeline = this.redis.pipeline();
      if (keys.length > 0) {
        pipeline.del(...keys);
      }
      pipeline.incr(ConfigCache.GLOBAL_VERSION_KEY);
      await pipeline.exec();
    } catch (err) {
      this.logger?.warn(
        '[config-cache] Full invalidation failed (non-fatal):',
        err instanceof Error ? err.message : String(err)
      );
    }
  }

  /**
   * Check whether a config value is currently cached in Redis.
   *
   * Returns the cached entry if present and fresh, or `null` if the key is
   * not cached or the cache is stale (version mismatch).
   */
  async peek<T = unknown>(key: string): Promise<CachedConfigEntry<T> | null> {
    if (!this.redis) return null;

    try {
      const entryRaw = await this.redis.get(`${ConfigCache.ENTRY_PREFIX}${key}`);

      if (!entryRaw) return null;

      const entry: CachedConfigEntry<T> = JSON.parse(entryRaw);
      const globalVersion = await this.fetchGlobalVersion();

      return this.isFreshEntry(entry, globalVersion) ? entry : null;
    } catch {
      return null;
    }
  }
  private isFreshEntry(entry: unknown, globalVersion: number): entry is CachedConfigEntry {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return false;
    const value = entry as Partial<CachedConfigEntry>;
    return (
      Number.isSafeInteger(globalVersion) &&
      globalVersion > 0 &&
      Number.isSafeInteger(value.version) &&
      Number(value.version) > 0 &&
      Object.hasOwn(value, 'value') &&
      value.cachedAtGlobalVersion === globalVersion
    );
  }
}
