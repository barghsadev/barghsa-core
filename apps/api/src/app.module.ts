import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common'
import { AppController } from './app.controller.js'
import { CorrelationIdMiddleware, CorrelationIdProvider, ShutdownService } from './common/index.js'
import { HealthModule } from './health/health.module.js'
import { MetricsModule } from './metrics/metrics.module.js'
import { RedisModule } from './redis/index.js'

@Module({
  imports: [RedisModule, HealthModule, MetricsModule],
  controllers: [AppController],
  providers: [CorrelationIdProvider, ShutdownService],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(CorrelationIdMiddleware).forRoutes('/*');
  }
}