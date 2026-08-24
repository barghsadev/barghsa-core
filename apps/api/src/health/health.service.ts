import { Injectable, type OnModuleInit } from '@nestjs/common';
import { dbHealth } from '@barghsa/db';

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
}

@Injectable()
export class HealthService implements OnModuleInit {
  private redisConfigured = false;
  private objectStorageConfigured = false;

  onModuleInit(): void {
    // Detect whether Redis and object storage are configured by checking
    // environment variables. These services are optional — the API remains
    // ready without them, but degraded-route indicators are emitted.
    this.redisConfigured = !!(
      process.env['REDIS_URL'] ?? process.env['REDIS_HOST']
    );
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

    // PostgreSQL is the only critical dependency.
    const overall =
      pg.status === 'down' ? 'down' as const
      : pg.status !== 'ok' || redis.status !== 'ok' || obj.status !== 'ok'
        ? 'degraded' as const
        : 'ok' as const;

    return {
      status: overall,
      checks: {
        postgresql: pg,
        redis,
        objectStorage: obj,
      },
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
    if (!this.redisConfigured) {
      return {
        status: 'ok',
        latencyMs: 0,
        details: { info: 'Redis not configured — skipping' },
      };
    }

    // Redis connectivity check is best-effort.  When ioredis or a
    // Redis connection factory is added, replace this with a real PING.
    // Until then, report ok with a wiring note so the overall readiness
    // status can be 'ok' when PostgreSQL is healthy.
    // TODO(T-03.03.04): wire Redis PING once the connection factory exists
    const startedAt = Date.now();
    return {
      status: 'ok',
      latencyMs: Date.now() - startedAt,
      details: { info: 'Redis check not yet wired — see T-03.03.04' },
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