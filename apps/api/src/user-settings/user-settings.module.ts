import { Module } from '@nestjs/common'
import { UserSettingsController } from './user-settings.controller.js'
import { SessionModule } from '../session/session.module.js'

@Module({
  imports: [SessionModule],
  controllers: [UserSettingsController],
})
export class UserSettingsModule {}