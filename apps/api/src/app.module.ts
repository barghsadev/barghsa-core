import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { AppController } from './app.controller.js';
import { CorrelationIdMiddleware, CorrelationIdProvider } from './common/correlation-id.middleware.js';
import { HealthModule } from './health/health.module.js';

@Module({
  imports: [HealthModule],
  controllers: [AppController],
  providers: [CorrelationIdProvider],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(CorrelationIdMiddleware).forRoutes('/*');
  }
}