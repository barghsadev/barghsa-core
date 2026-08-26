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

import { AuthModule } from './auth/index.js'
import { SessionModule } from './session/index.js'
import { ProfilesModule } from './profiles/index.js'
import { GeographyModule } from './geography/geography.module.js'
import { UserSettingsModule } from './user-settings/index.js'
import { OrdersModule } from './orders/index.js'
import { TosModule } from './tos/tos.module.js'
import { AdminModule } from './admin/index.js'
import { CrmModule } from './crm/index.js'
import { TicketsModule } from './tickets/index.js'
import { VerificationModule } from './verification/verification.module.js'
import { DashboardModule } from './dashboard/dashboard.module.js'
import { NotificationsModule } from './notifications/index.js'
import { WalletModule } from './wallet/index.js'

@Module({
  imports: [RedisModule, ConfigCacheModule, HealthModule, MetricsModule, RateLimitModule, StorageModule, UploadModule, CspReportModule, AuthModule, SessionModule, ProfilesModule, GeographyModule, UserSettingsModule, OrdersModule, TosModule, CrmModule, AdminModule, TicketsModule, VerificationModule, DashboardModule, NotificationsModule, WalletModule],
  controllers: [AppController],
  providers: [CorrelationIdProvider, ShutdownService],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(CorrelationIdMiddleware).forRoutes('/*');
  }
}