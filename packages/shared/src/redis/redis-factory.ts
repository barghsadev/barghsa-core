import { Redis } from 'ioredis';
import { RedisConfigSchema, type RedisConfig, DEFAULT_REDIS_CONFIG } from './redis-config.js';

// ---------------------------------------------------------------------------
// Logger contract — no framework dependency
// ---------------------------------------------------------------------------

export interface Logger {
  warn(message: string, ...meta: unknown[]): void;
  error(message: string, ...meta: unknown[]): void;
}

// ---------------------------------------------------------------------------
// Ping result
// ---------------------------------------------------------------------------

export interface PingResult {
  ok: boolean;
  latencyMs: number;
  error?: string;
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Create a Redis client with graceful fallback.
 *
 * Returns `null` when:
 * - No `REDIS_URL` (or equivalent config) is set — Redis is intentionally absent.
 * - Config validation fails — logged and skipped.
 * - The initial connection attempt fails — a warning is logged and
 *   the app proceeds without Redis.
 *
 * All consumers **must** guard every Redis call with `if (redis)` to ensure
 * graceful degradation.
 *
 * @example
 * ```ts
 * const redis = await createRedisClient({ url: process.env['REDIS_URL'] });
 * // … later:
 * if (redis) {
 *   await redis.set('key', 'value');
 * }
 * ```
 */
export async function createRedisClient(
  config: RedisConfig,
  logger?: Logger,
): Promise<Redis | null> {
  // --- Resolve config -------------------------------------------------------
  const merged: RedisConfig = { ...DEFAULT_REDIS_CONFIG, ...config };

  // --- No connection target → skip -----------------------------------------
  const effectiveUrl = merged.url ?? process.env['REDIS_URL'];
  if (!effectiveUrl && !merged.host) {
    return null;
  }

  // --- Parse & validate ----------------------------------------------------
  const parsed = RedisConfigSchema.safeParse(merged);
  if (!parsed.success) {
    const msg = `[redis-factory] Invalid Redis configuration: ${parsed.error.message}`;
    logger?.error(msg);
    return null;
  }

  // --- Build ioredis options -----------------------------------------------
  const opts: import('ioredis').RedisOptions = {
    maxRetriesPerRequest: parsed.data.maxRetriesPerRequest ?? null,
    enableReadyCheck: parsed.data.enableReadyCheck ?? true,
    lazyConnect: true, // Defer so we can attempt initial connection with null-on-failure
    connectTimeout: parsed.data.connectTimeout ?? 10_000,
    retryStrategy(times: number): number | null {
      // Fail fast: on initial connection, give up after 3 quick retries
      if (times > 3) return null;
      return Math.min(times * 200, 1_000);
    },
  };

  if (parsed.data.password) {
    opts.password = parsed.data.password;
  }
  if (parsed.data.keyPrefix) {
    opts.keyPrefix = parsed.data.keyPrefix;
  }

  // Apply TLS configuration
  if (parsed.data.tls) {
    opts.tls = parsed.data.tls === true ? {} : parsed.data.tls;
  }

  let client: Redis;

  if (effectiveUrl) {
    client = new Redis(effectiveUrl, opts);
  } else if (parsed.data.host) {
    opts.host = parsed.data.host;
    opts.port = parsed.data.port ?? 6379;
    client = new Redis(opts);
  } else {
    return null;
  }

  // --- Error handler -------------------------------------------------------
  client.on('error', (err: Error) => {
    logger?.warn('[redis] Connection error (degraded):', err.message);
  });

  // --- Connection guard: attempt initial connect ---------------------------
  try {
    await client.connect();
  } catch (err) {
    logger?.warn(
      '[redis-factory] Initial connection failed, returning null (degraded):',
      err instanceof Error ? err.message : String(err),
    );
    client.disconnect();
    return null;
  }

  return client;
}

/**
 * Check whether a Redis client is connected and responsive.
 *
 * Returns `{ ok: true, latencyMs }` on success.
 * Returns `{ ok: false, latencyMs, error }` on failure.
 *
 * Safe to call with `null` — returns `{ ok: false, latencyMs: 0, error: 'not connected' }`.
 */
export async function pingRedis(
  client: Redis | null,
): Promise<PingResult> {
  if (!client) {
    return { ok: false, latencyMs: 0, error: 'not connected' };
  }

  if (client.status !== 'ready') {
    return { ok: false, latencyMs: 0, error: `status=${client.status}` };
  }

  const startedAt = Date.now();
  try {
    await client.ping();
    return { ok: true, latencyMs: Date.now() - startedAt };
  } catch (err) {
    return {
      ok: false,
      latencyMs: Date.now() - startedAt,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}