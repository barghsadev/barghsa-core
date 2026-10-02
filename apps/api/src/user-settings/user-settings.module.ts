import { Module } from '@nestjs/common';
import { UserSettingsController } from './user-settings.controller.js';
import { SessionModule } from '../session/session.module.js';
import { AnalyticsController } from './analytics.controller.js';
import { ConversationIdentityController } from './conversation-identity.controller.js';
import { ConversationIdentityService } from './conversation-identity.service.js';
import { VerifiedAttachmentsService } from '../storage/verified-attachments.service.js';

@Module({
  imports: [SessionModule],
  controllers: [UserSettingsController, AnalyticsController, ConversationIdentityController],
  providers: [ConversationIdentityService, VerifiedAttachmentsService],
})
export class UserSettingsModule {}
