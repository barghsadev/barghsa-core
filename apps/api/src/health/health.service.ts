import { Inject, Injectable } from '@nestjs/common';
import { dbHealth } from '@barghsa/db';
import { pingRedis } from '@barghsa/shared/redis';
import type { Redis } from 'ioredis';
import { REDIS_CLIENT } from '../redis/index.js';
import type { StorageProvider } from '@barghsa/shared/storage';
import { STORAGE_PROVIDER } from '../storage/storage.constants.js';

/**
 * Service-level health status returned by the ready endpoint.
 * Inspired by the Terminus contract but without the `@nestjs/terminus`
 * dependency — kept lean with custom health-indicator functions.
 */
export interface HealthIndicatorResult {
  status: 'ok' | 'degraded' | 'down';
  latencyMs: number;
  details?: Record<string, unknown>;
}

export interface ReadinessResult {
  status: 'ok' | 'degraded' | 'down';
  checks: {
    postgresql: HealthIndicatorResult;
    redis: HealthIndicatorResult;
    objectStorage: HealthIndicatorResult;
  };
  /**
   * Non-critical warnings emitted as `X-Health-Warning` headers.
   * These do not affect the overall status — the API is ready but
   * an optional dependency is unavailable.
   */
  warnings?: string[];
}

@Injectable()
export class HealthService {
  private storageProbe: Promise<HealthIndicatorResult> | undefined;

  constructor(
    @Inject(REDIS_CLIENT)
    private readonly redis: Redis | null,
    @Inject(STORAGE_PROVIDER)
    private readonly storage: Pick<StorageProvider, 'checkHealth'>
  ) {}

  /**
   * Liveness probe — always returns ok immediately.
   * If the process is alive enough to respond to HTTP, it's alive.
   * No dependency checks.
   */
  liveness(): { status: string } {
    return { status: 'ok' };
  }

  /**
   * Readiness probe — checks all configured dependencies.
   * Returns 503 semantics when critical dependencies are down.
   */
  async readiness(): Promise<ReadinessResult> {
    const [pg, redis, obj] = await Promise.all([
      this.checkPostgresql(),
      this.checkRedis(),
      this.checkObjectStorage(),
    ]);

    // Collect non-critical warnings for the `X-Health-Warning` header.
    const warnings: string[] = [];
    if (redis.details?.degraded) {
      warnings.push('redis-unavailable');
    }
    if (obj.status !== 'ok') warnings.push('object-storage-unavailable');

    // PostgreSQL is the only critical dependency.
    //   - Redis down  → overall ok (warning emitted via header)
    //   - Object storage down → overall degraded
    const overall =
      pg.status === 'down'
        ? ('down' as const)
        : obj.status !== 'ok'
          ? ('degraded' as const)
          : ('ok' as const);

    return {
      status: overall,
      checks: {
        postgresql: pg,
        redis,
        objectStorage: obj,
      },
      ...(warnings.length > 0 ? { warnings } : {}),
    };
  }

  /* ------------------------------------------------------------------ */
  /*  Individual health-indicator functions                              */
  /* ------------------------------------------------------------------ */

  private async checkPostgresql(): Promise<HealthIndicatorResult> {
    const result = await dbHealth({ verifySchema: true });
    if (!result.ok) {
      return {
        status: 'down',
        latencyMs: result.latencyMs,
        details: { error: 'PostgreSQL unavailable or schema incompatible' },
      };
    }
    return {
      status: 'ok',
      latencyMs: result.latencyMs,
      details: {
        poolStats: result.poolStats,
      },
    };
  }

  private async checkRedis(): Promise<HealthIndicatorResult> {
    if (!this.redis) {
      return {
        status: 'ok',
        latencyMs: 0,
        details:
          process.env['REDIS_URL'] || process.env['REDIS_HOST']
            ? { error: 'Configured Redis unavailable', degraded: true }
            : { info: 'Redis not configured — skipping' },
      };
    }

    const ping = await pingRedis(this.redis);
    if (!ping.ok) {
      return {
        status: 'ok',
        latencyMs: ping.latencyMs,
        details: { error: ping.error, degraded: true },
      };
    }

    return {
      status: 'ok',
      latencyMs: ping.latencyMs,
    };
  }

  private async checkObjectStorage(): Promise<HealthIndicatorResult> {
    if (this.storageProbe) return this.storageProbe;
    const startedAt = Date.now();
    const controller = new AbortController();
    const unavailable = (): HealthIndicatorResult => ({
      status: 'degraded',
      latencyMs: Date.now() - startedAt,
      details: { error: 'Object storage unavailable or not configured' },
    });
    const work = Promise.resolve().then(async (): Promise<HealthIndicatorResult> => {
      try {
        if (!this.storage.checkHealth) return unavailable();
        await this.storage.checkHealth(controller.signal);
        return { status: 'ok', latencyMs: Date.now() - startedAt };
      } catch {
        return unavailable();
      }
    });
    let timer: ReturnType<typeof setTimeout>;
    const timeout = new Promise<HealthIndicatorResult>((resolve) => {
      timer = setTimeout(() => {
        controller.abort();
        resolve(unavailable());
      }, 1500);
    });
    const probe = Promise.race([work, timeout]);
    this.storageProbe = probe;
    // Keep sharing the bounded result until even an uncooperative configuration
    // loader settles, so repeated public probes cannot accumulate work.
    const settled = () => {
      clearTimeout(timer);
      if (this.storageProbe === probe) this.storageProbe = undefined;
    };
    void work.then(settled);
    return probe;
  }
}
