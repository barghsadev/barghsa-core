import { Controller, Get, HttpCode, HttpStatus } from '@nestjs/common';
import { HealthService, type ReadinessResult } from './health.service.js';

@Controller('api/health')
export class HealthController {
  constructor(private readonly healthService: HealthService) {}

  /**
   * Liveness probe — the simplest possible health check.
   * Returns immediately with `{ status: 'ok' }` if the process is alive.
   *
   * Excluded from authentication, rate limiting, and audit logging.
   */
  @Get('live')
  @HttpCode(HttpStatus.OK)
  liveness(): { status: string } {
    return this.healthService.liveness();
  }

  /**
   * Readiness probe — checks critical and optional dependencies.
   *
   * - **PostgreSQL:** critical — returns 503 if unreachable
   * - **Redis:** optional — reported as degraded if down; API stays ready
   * - **Object storage:** optional — reported as degraded if down; API stays ready
   *
   * Returns `200 OK` when all critical dependencies are healthy.
   * Returns `503 Service Unavailable` when PostgreSQL is down.
   *
   * Excluded from authentication, rate limiting, and audit logging.
   */
  @Get('ready')
  async readiness(): Promise<ReadinessResult> {
    return this.healthService.readiness();
  }
}