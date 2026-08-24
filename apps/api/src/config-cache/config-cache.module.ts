import { Global, Module } from '@nestjs/common'
import { ConfigCacheService, CONFIG_CACHE } from './config-cache.service.js'

/**
 * Configuration caching module for the Barghsa API.
 *
 * Provides Redis-backed config caching with version-gated staleness detection.
 * Config settings (VAT rates, product prices, thresholds) are cached for 5
 * minutes with a global version counter that forces cache refresh on any write.
 *
 * ## Graceful degradation
 *
 * - No Redis → reads go directly to PostgreSQL (no caching).
 * - Redis connection lost mid-operation → transparent PG fallback.
 *
 * Import this module in `AppModule` to enable config caching across the API.
 *
 * @example
 * ```ts
 * @Injectable()
 * class VatService {
 *   constructor(
 *     @Inject(CONFIG_CACHE)
 *     private readonly configCache: ConfigCacheService,
 *   ) {}
 * }
 * ```
 */
@Global()
@Module({
  providers: [
    ConfigCacheService,
    {
      provide: CONFIG_CACHE,
      useExisting: ConfigCacheService,
    },
  ],
  exports: [ConfigCacheService, CONFIG_CACHE],
})
export class ConfigCacheModule {}