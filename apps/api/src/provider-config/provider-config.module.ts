import { Module } from '@nestjs/common'
import { EmailProviderConfigService } from './email-provider-config.service'
import { EmailProviderConfigController } from './email-provider-config.controller'
import { SmtpConnectionTesterService } from './smtp-connection-tester.service'
import { SmtpNetworkGuard } from './smtp-network-guard'
import { ResendConnectionTesterService } from './resend-connection-tester.service'
import { ProviderSecretsService } from './provider-secrets.service'
import { EmailCircuitBreakerService } from './email-circuit-breaker.service'
import { SessionModule } from '../session/index.js'

/**
 * Email provider administration module (E-05, T-05.06.01–06).
 *
 * Owns the durable `email_provider_configs` entity and its Draft/Test/Active/
 * Superseded/Disabled lifecycle plus the live SMTP connection tester with SSRF
 * network guard (T-05.06.02), the Resend domain-verification + test-send
 * tester (T-05.06.03), the field-level secrets encryption/masking service
 * (T-05.06.05), and the per-provider email circuit breaker (T-05.06.06) which
 * marks a provider `degraded` after repeated transient failures and gates the
 * send path via `EmailProviderConfigService.breakerDecision()`.
 */
@Module({
  controllers: [EmailProviderConfigController],
  providers: [
    EmailProviderConfigService,
    SmtpConnectionTesterService,
    SmtpNetworkGuard,
    ResendConnectionTesterService,
    ProviderSecretsService,
    EmailCircuitBreakerService,
  ],
  imports: [SessionModule],
  exports: [
    EmailProviderConfigService,
    SmtpConnectionTesterService,
    ResendConnectionTesterService,
    ProviderSecretsService,
    EmailCircuitBreakerService,
  ],
})
export class ProviderConfigModule {}
