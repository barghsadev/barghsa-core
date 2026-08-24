import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common'
import { AppController } from './app.controller.js'
import { CorrelationIdMiddleware, CorrelationIdProvider, ShutdownService } from './common/index.js'
import { HealthModule } from './health/health.module.js'
import { MetricsModule } from './metrics/metrics.module.js'
import { ConfigCacheModule } from './config-cache/index.js'
import { RedisModule } from './redis/index.js'
import { RateLimitModule } from './rate-limit/index.js'
import { StorageModule } from './storage/index.js'
import { UploadModule } from './upload/index.js'
import { CspReportModule } from './csp-report/csp-report.module.js'

@Module({
  imports: [RedisModule, ConfigCacheModule, HealthModule, MetricsModule, RateLimitModule, StorageModule, UploadModule, CspReportModule],
  controllers: [AppController],
  providers: [CorrelationIdProvider, ShutdownService],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(CorrelationIdMiddleware).forRoutes('/*');
  }
}