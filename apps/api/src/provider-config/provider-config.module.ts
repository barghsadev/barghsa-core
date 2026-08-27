import { Module } from '@nestjs/common'
import { EmailProviderConfigService } from './email-provider-config.service'
import { EmailProviderConfigController } from './email-provider-config.controller'
import { SmtpConnectionTesterService } from './smtp-connection-tester.service'
import { SmtpNetworkGuard } from './smtp-network-guard'
import { ResendConnectionTesterService } from './resend-connection-tester.service'
import { ProviderSecretsService } from './provider-secrets.service'
import { SessionModule } from '../session/index.js'

/**
 * Email provider administration module (E-05, T-05.06.01–05).
 *
 * Owns the durable `email_provider_configs` entity and its Draft/Test/Active/
 * Superseded/Disabled lifecycle plus the live SMTP connection tester with SSRF
 * network guard (T-05.06.02), the Resend domain-verification + test-send
 * tester (T-05.06.03), and the field-level secrets encryption/masking service
 * (T-05.06.05) wired into every config write/read.
 */
@Module({
  controllers: [EmailProviderConfigController],
  providers: [
    EmailProviderConfigService,
    SmtpConnectionTesterService,
    SmtpNetworkGuard,
    ResendConnectionTesterService,
    ProviderSecretsService,
  ],
  imports: [SessionModule],
  exports: [
    EmailProviderConfigService,
    SmtpConnectionTesterService,
    ResendConnectionTesterService,
    ProviderSecretsService,
  ],
})
export class ProviderConfigModule {}
