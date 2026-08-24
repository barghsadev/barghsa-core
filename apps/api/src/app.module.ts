import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { AppController } from './app.controller.js';
import { CorrelationIdMiddleware, CorrelationIdProvider } from './common/correlation-id.middleware.js';

@Module({
  imports: [],
  controllers: [AppController],
  providers: [CorrelationIdProvider],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(CorrelationIdMiddleware).forRoutes('/*');
  }
}