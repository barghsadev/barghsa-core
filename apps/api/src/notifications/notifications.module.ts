import { Module } from '@nestjs/common'
import { NotificationsController } from './notifications.controller.js'
import { NotificationsService } from './notifications.service.js'
import { NotificationTemplateService } from './notification-template.service.js'
import { SessionModule } from '../session/index.js'

@Module({
  controllers: [NotificationsController],
  providers: [NotificationsService, NotificationTemplateService],
  imports: [SessionModule],
  exports: [NotificationsService, NotificationTemplateService],
})
export class NotificationsModule {}
