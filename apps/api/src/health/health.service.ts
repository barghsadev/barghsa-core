import { Inject, Injectable, type OnModuleInit } from '@nestjs/common';
import { dbHealth } from '@barghsa/db';
import { pingRedis } from '@barghsa/shared/redis';
import type { Redis } from 'ioredis';
import { REDIS_CLIENT } from '../redis/index.js';

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
export class HealthService implements OnModuleInit {
  private objectStorageConfigured = false;

  constructor(
    @Inject(REDIS_CLIENT)
    private readonly redis: Redis | null,
  ) {}

  onModuleInit(): void {
    // Detect whether object storage is configured by checking
    // environment variables. These services are optional — the API remains
    // ready without them, but degraded-route indicators are emitted.
    this.objectStorageConfigured = !!(
      process.env['S3_ENDPOINT'] ?? process.env['MINIO_ENDPOINT']
    );
  }

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

    // PostgreSQL is the only critical dependency.
    //   - Redis down  → overall ok (warning emitted via header)
    //   - Object storage down → overall degraded
    const overall =
      pg.status === 'down' ? 'down' as const
      : obj.status !== 'ok'   ? 'degraded' as const
      : 'ok' as const;

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
    const result = await dbHealth();
    if (!result.ok) {
      return {
        status: 'down',
        latencyMs: result.latencyMs,
        details: { error: 'PostgreSQL unreachable' },
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
        details: { info: 'Redis not configured — skipping' },
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
    if (!this.objectStorageConfigured) {
      return {
        status: 'ok',
        latencyMs: 0,
        details: { info: 'Object storage not configured — skipping' },
      };
    }

    // TODO(T-04.03.xx): wire real S3/MinIO head-bucket check
    const startedAt = Date.now();
    return {
      status: 'ok',
      latencyMs: Date.now() - startedAt,
      details: { info: 'Object storage check not yet wired' },
    };
  }
}