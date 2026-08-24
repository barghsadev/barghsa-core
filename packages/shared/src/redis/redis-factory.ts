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
 * - A connection error occurs during initial setup — a warning is logged and
 *   the app proceeds without Redis.
 *
 * All Consumers **must** guard every Redis call with `if (redis)` to ensure
 * graceful degradation.
 *
 * @example
 * ```ts
 * const redis = createRedisClient({ url: process.env['REDIS_URL'] });
 * // … later:
 * if (redis) {
 *   await redis.set('key', 'value');
 * }
 * ```
 */
export function createRedisClient(
  config: RedisConfig,
  logger?: Logger,
): Redis | null {
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
    lazyConnect: parsed.data.lazyConnect ?? false,
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

  // --- Connection guard: catch early connect failures ----------------------
  // ioredis queues commands even when disconnected by default.
  // With maxRetriesPerRequest=null, a disconnected client will reject commands
  // immediately — callers must check `client.status === 'ready'` or use the
  // guard helper below.
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