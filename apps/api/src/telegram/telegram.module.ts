import { Module } from '@nestjs/common';
import { SessionModule } from '../session/index.js';
import { AiAgentsModule } from '../ai-agents/ai-agents.module.js';
import { TelegramLinksService } from './telegram-links.service.js';
import { TelegramRuntimeService } from './telegram-runtime.service.js';
import { TelegramLinksController } from './telegram-links.controller.js';
import { TelegramWebhookController } from './telegram-webhook.controller.js';

@Module({
  imports: [SessionModule, AiAgentsModule],
  controllers: [TelegramLinksController, TelegramWebhookController],
  providers: [TelegramLinksService, TelegramRuntimeService],
})
export class TelegramModule {}
