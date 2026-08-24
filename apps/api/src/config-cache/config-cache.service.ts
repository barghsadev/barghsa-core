import { Inject, Injectable, Logger, Optional } from '@nestjs/common'
import type { Redis } from 'ioredis'
import { ConfigCache, type ConfigCacheLogger } from '@barghsa/shared/config-cache'
import { getDbPool } from '@barghsa/db'
import { REDIS_CLIENT } from '../redis/index.js'

/**
 * NestJS injection token for the ConfigCache service.
 */
export const CONFIG_CACHE = Symbol('CONFIG_CACHE')

/**
 * Injectable wrapper around the framework-agnostic {@link ConfigCache} class.
 *
 * Provides Redis-backed configuration caching with version-gated staleness
 * detection to the NestJS application layer.  Wires the PostgreSQL read
 * callback and NestJS Logger automatically.
 *
 * ## Usage
 *
 * ```ts
 * @Injectable()
 * export class VatService {
 *   constructor(
 *     @Inject(CONFIG_CACHE)
 *     private readonly configCache: ConfigCacheService,
 *   ) {}
 *
 *   async getVatRate(): Promise<number> {
 *     return this.configCache.get<number>('vat_rate');
 *   }
 * }
 * ```
 *
 * Or inject {@link CONFIG_CACHE} token directly for the raw {@link ConfigCache}
 * instance.
 */
@Injectable()
export class ConfigCacheService {
  private readonly cache: ConfigCache
  private readonly logger = new Logger(ConfigCacheService.name)

  constructor(
    @Inject(REDIS_CLIENT)
    @Optional()
    private readonly redis: Redis | null,
  ) {
    const cacheLogger: ConfigCacheLogger = {
      warn: (msg: string, ...meta: unknown[]) => this.logger.warn(msg, ...meta),
      error: (msg: string, ...meta: unknown[]) => this.logger.error(msg, ...meta),
    }

    this.cache = new ConfigCache(
      // fetchFromDb — reads from the app_config table via the shared db pool
      async (key: string) => {
        const pool = getDbPool()
        const result = await pool.query(
          'SELECT value, version FROM app_config WHERE key = $1',
          [key],
        )
        if (result.rows.length === 0) return null
        return {
          value: result.rows[0]['value'],
          version: Number(result.rows[0]['version']),
        }
      },
      // fetchGlobalVersion — reads the global config version from Redis,
      // or falls back to PG, or returns 0 if neither is available
      async () => {
        // When Redis is available, read the global version from Redis
        if (this.redis) {
          try {
            const raw = await this.redis.get(ConfigCache.GLOBAL_VERSION_KEY)
            if (raw) return Number(raw)
          } catch {
            // Fall through to PG below
          }
        }
        // Read from PostgreSQL as fallback
        try {
          const pool = getDbPool()
          const result = await pool.query(
            "SELECT version FROM config_version WHERE id = 'global'",
          )
          if (result.rows.length > 0) {
            return Number(result.rows[0]['version'])
          }
        } catch {
          // If PG is also unavailable, return 0 — all cached entries will be
          // considered stale, forcing PG reads.  Degraded but correct.
        }
        return 0
      },
      this.redis,
      cacheLogger,
    )
  }

  /** Retrieve a configuration value by key. */
  async get<T = unknown>(key: string): Promise<T | null> {
    return this.cache.get<T>(key)
  }

  /** Retrieve a config value with cache freshness metadata. */
  async getWithVersion<T = unknown>(key: string) {
    return this.cache.getWithVersion<T>(key)
  }

  /** Invalidate a single config entry and bump the global version counter. */
  async invalidate(key: string): Promise<void> {
    return this.cache.invalidate(key)
  }

  /** Invalidate all cached config entries. */
  async invalidateAll(): Promise<void> {
    return this.cache.invalidateAll()
  }

  /** Peek at a cached config entry without triggering a PG read. */
  async peek<T = unknown>(key: string) {
    return this.cache.peek<T>(key)
  }
}