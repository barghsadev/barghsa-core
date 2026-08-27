import { Controller, Post, HttpCode, HttpStatus, Req } from '@nestjs/common'
import type { IncomingMessage } from 'node:http'
import { EmailWebhookService } from './email-webhook.service'
import type { ResendWebhookHeaders } from './email-webhook.types'

/**
 * Minimal request surface extended with `rawBody` (populated by Nest's
 * `rawBody: true` body option configured in `main.ts`).
 */
interface WebhookRequest extends IncomingMessage {
  rawBody?: Buffer
}

/**
 * Resend delivery-callback receiver (E-05, T-05.06.07).
 *
 * `POST /api/webhooks/email/resend` — receives `email.delivered`,
 * `email.bounced`, `email.complained`, `email.opened` and `email.clicked`
 * events. Authenticated via the Svix HMAC signature; replay-safe via the
 * unique `svix-id` ledger. Returns 2xx for both processed and duplicate
 * events so Resend does not re-deliver.
 *
 * The controller deliberately reads the RAW body (`req.rawBody`) — signature
 * verification must run over the exact bytes the provider signed, never a
 * re-serialized JSON object.
 */
@Controller('api/webhooks/email/resend')
export class EmailWebhookController {
  constructor(private readonly webhookService: EmailWebhookService) {}

  @Post()
  @HttpCode(HttpStatus.OK)
  async receive(@Req() req: WebhookRequest): Promise<{ received: true }> {
    const headers: ResendWebhookHeaders = {
      id: req.headers['svix-id'] as string | undefined,
      timestamp: req.headers['svix-timestamp'] as string | undefined,
      signature: req.headers['svix-signature'] as string | undefined,
    }
    const rawBody = req.rawBody?.toString('utf8') ?? ''
    await this.webhookService.handle(headers, rawBody)
    return { received: true }
  }
}