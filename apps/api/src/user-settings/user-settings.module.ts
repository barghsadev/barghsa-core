import { Module } from '@nestjs/common';
import { UserSettingsController } from './user-settings.controller.js';
import { SessionModule } from '../session/session.module.js';
import { AnalyticsController } from './analytics.controller.js';

@Module({
  imports: [SessionModule],
  controllers: [UserSettingsController, AnalyticsController],
})
export class UserSettingsModule {}
