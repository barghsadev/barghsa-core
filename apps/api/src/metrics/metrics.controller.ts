import { Controller, Get, Header, Logger } from '@nestjs/common'
import { MetricsService } from './metrics.service.js'

/**
 * Controller that exposes PostgreSQL performance metrics in Prometheus
 * text-format at GET /metrics.
 *
 * In production, this endpoint is scraped by a Prometheus server.  Access
 * should be restricted to internal/private networks or authenticated via
 * a reverse-proxy sidecar (e.g., nginx basic auth).
 *
 * Metrics include:
 *   - PostgreSQL system views (cache hit ratio, connections, WAL, etc.)
 *   - Node.js runtime metrics (default Prometheus registry)
 *   - Application-level gauges (long-running queries, top-N query durations)
 */
@Controller()
export class MetricsController {
  private readonly logger = new Logger(MetricsController.name)

  constructor(private readonly metricsService: MetricsService) {}

  @Get('metrics')
  @Header('Content-Type', 'text/plain; charset=utf-8')
  @Header('Cache-Control', 'no-store, no-cache, must-revalidate')
  async getMetrics(): Promise<string> {
    try {
      return await this.metricsService.collect()
    } catch (err) {
      this.logger.error(
        `Failed to serve /metrics: ${err instanceof Error ? err.message : String(err)}`,
      )
      throw err
    }
  }
}