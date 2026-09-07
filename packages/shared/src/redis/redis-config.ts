import { z } from 'zod';

/**
 * Zod schema for Redis configuration.
 *
 * - `url` — full Redis connection string (defaults to `REDIS_URL` env var)
 * - `host` / `port` — alternative to `url` for fine-grained control
 * - `password` — optional AUTH password
 * - `tls` — enable TLS in production (auto-detected when `url` starts with `rediss://`)
 * - `keyPrefix` — optional prefix for all keys to namespace by environment
 * - `maxRetriesPerRequest` — ioredis retry limit; `null` waits through reconnects; commands still have a deadline (default: 1)
 * - `enableReadyCheck` — wait for READY event before resolving (default: true)
 * - `lazyConnect` — if true, connect is deferred until the first command (default: false)
 * - `commandTimeout` — maximum command wait in ms (default: 1000)
 * - `connectTimeout` — connection timeout in ms (default: 10000)
 */
export const RedisConfigSchema = z.object({
  url: z.string().optional(),
  host: z.string().optional(),
  port: z.coerce.number().int().positive().max(65535).optional(),
  password: z.string().optional(),
  tls: z.union([z.boolean(), z.looseObject({})]).optional(),
  keyPrefix: z.string().optional(),
  maxRetriesPerRequest: z.number().int().min(0).nullable().optional(),
  enableReadyCheck: z.boolean().optional(),
  lazyConnect: z.boolean().optional(),
  commandTimeout: z.number().int().positive().optional(),
  connectTimeout: z.number().int().positive().optional(),
});

export type RedisConfig = z.infer<typeof RedisConfigSchema>;

/** Well-known defaults that balance reliability with graceful degradation. */
export const DEFAULT_REDIS_CONFIG: Partial<RedisConfig> = {
  maxRetriesPerRequest: 1,
  commandTimeout: 1_000,
  enableReadyCheck: true,
  lazyConnect: false,
  connectTimeout: 10_000,
};
