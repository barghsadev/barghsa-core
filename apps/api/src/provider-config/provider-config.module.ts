import { Module } from '@nestjs/common'
import { EmailProviderConfigService } from './email-provider-config.service'
import { EmailProviderConfigController } from './email-provider-config.controller'
import { SmtpConnectionTesterService } from './smtp-connection-tester.service'
import { SmtpNetworkGuard } from './smtp-network-guard'
import { ResendConnectionTesterService } from './resend-connection-tester.service'
import { SessionModule } from '../session/index.js'

/**
 * Email provider administration module (E-05, T-05.06.01–03).
 *
 * Owns the durable `email_provider_configs` entity and its Draft/Test/Active/
 * Superseded/Disabled lifecycle plus the live SMTP connection tester with SSRF
 * network guard (T-05.06.02) and the Resend domain-verification + test-send
 * tester (T-05.06.03). Secrets encryption and the admin UI arrive in
 * T-05.06.04–05.
 */
@Module({
  controllers: [EmailProviderConfigController],
  providers: [
    EmailProviderConfigService,
    SmtpConnectionTesterService,
    SmtpNetworkGuard,
    ResendConnectionTesterService,
  ],
  imports: [SessionModule],
  exports: [
    EmailProviderConfigService,
    SmtpConnectionTesterService,
    ResendConnectionTesterService,
  ],
})
export class ProviderConfigModule {}
