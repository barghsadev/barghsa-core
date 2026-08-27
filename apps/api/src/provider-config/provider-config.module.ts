import { Module } from '@nestjs/common'
import { EmailProviderConfigService } from './email-provider-config.service'
import { EmailProviderConfigController } from './email-provider-config.controller'
import { SessionModule } from '../session/index.js'

/**
 * Email provider administration module (E-05, T-05.06.01).
 *
 * Owns the durable `email_provider_configs` entity and its Draft/Test/Active/
 * Superseded/Disabled lifecycle. Transport-specific SMTP/Resend configuration,
 * connection-testing, secrets encryption, and the admin UI arrive in
 * T-05.06.02–05.
 */
@Module({
  controllers: [EmailProviderConfigController],
  providers: [EmailProviderConfigService],
  imports: [SessionModule],
  exports: [EmailProviderConfigService],
})
export class ProviderConfigModule {}
