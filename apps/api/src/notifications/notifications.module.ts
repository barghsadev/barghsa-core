import { Module } from '@nestjs/common'
import { NotificationsController } from './notifications.controller.js'
import { NotificationsService } from './notifications.service.js'
import { SessionModule } from '../session/index.js'

@Module({
  controllers: [NotificationsController],
  providers: [NotificationsService],
  imports: [SessionModule],
  exports: [NotificationsService],
})
export class NotificationsModule {}
