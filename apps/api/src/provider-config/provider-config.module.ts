import { Module } from '@nestjs/common'
import { EmailProviderConfigService } from './email-provider-config.service'
import { EmailProviderConfigController } from './email-provider-config.controller'
import { SmtpConnectionTesterService } from './smtp-connection-tester.service'
import { SmtpNetworkGuard } from './smtp-network-guard'
import { SessionModule } from '../session/index.js'

/**
 * Email provider administration module (E-05, T-05.06.01–02).
 *
 * Owns the durable `email_provider_configs` entity and its Draft/Test/Active/
 * Superseded/Disabled lifecycle plus the live SMTP connection tester with SSRF
 * network guard (T-05.06.02). Resend configuration/testing, secrets encryption,
 * and the admin UI arrive in T-05.06.03–05.
 */
@Module({
  controllers: [EmailProviderConfigController],
  providers: [
    EmailProviderConfigService,
    SmtpConnectionTesterService,
    SmtpNetworkGuard,
  ],
  imports: [SessionModule],
  exports: [EmailProviderConfigService, SmtpConnectionTesterService],
})
export class ProviderConfigModule {}
