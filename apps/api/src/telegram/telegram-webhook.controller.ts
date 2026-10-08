import { Body, Controller, Header, HttpCode, HttpException, Post, Req } from '@nestjs/common';
import type { Request } from 'express';
import { ApiTags } from '@nestjs/swagger';
import { SkipCsrf } from '../session/csrf.guard.js';
import { validTelegramWebhookSecret } from './telegram-protocol.js';
import { TelegramRuntimeService } from './telegram-runtime.service.js';

@ApiTags('Telegram · authenticated provider callback')
@Controller('api/telegram/webhook')
export class TelegramWebhookController {
  constructor(private readonly runtime: TelegramRuntimeService) {}
  @Post()
  @SkipCsrf()
  @HttpCode(200)
  @Header('Cache-Control', 'private, no-store')
  receive(@Req() req: Request, @Body() body: unknown) {
    if (
      !validTelegramWebhookSecret(
        process.env['CUSTOMER_TELEGRAM_WEBHOOK_SECRET'],
        req.headers['x-telegram-bot-api-secret-token']
      )
    )
      throw new HttpException({ error: 'TELEGRAM_WEBHOOK_UNAUTHORIZED' }, 401);
    return this.runtime.receive(body);
  }
}
