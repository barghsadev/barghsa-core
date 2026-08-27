import { Module } from '@nestjs/common'
import { EmailWebhookController } from './email-webhook.controller'
import { EmailWebhookService } from './email-webhook.service'
import { ProviderSecretsService } from '../provider-config/provider-secrets.service'

/**
 * Resend delivery-callback receiver module (E-05, T-05.06.07).
 *
 * Owns the authenticated, replay-safe `POST /api/webhooks/email/resend`
 * endpoint and the durable event ledger / suppression tables it feeds.
 *
 * The `EMAIL_WEBHOOK_POOL` injection token is intentionally NOT registered, so
 * production uses the shared `@barghsa/db` pool and unit tests can construct
 * `EmailWebhookService` directly with a mock pool.
 */
@Module({
  controllers: [EmailWebhookController],
  providers: [EmailWebhookService, ProviderSecretsService],
  exports: [EmailWebhookService],
})
export class EmailWebhookModule {}