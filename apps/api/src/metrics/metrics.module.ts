import { Module } from '@nestjs/common'
import { MetricsController } from './metrics.controller.js'
import { MetricsService } from './metrics.service.js'

/**
 * Module that exposes PostgreSQL performance and Node.js runtime metrics
 * at GET /metrics in Prometheus text format.
 *
 * Imported by AppModule to register the /metrics route and background
 * metric polling.
 */
@Module({
  controllers: [MetricsController],
  providers: [MetricsService],
  exports: [MetricsService],
})
export class MetricsModule {}
