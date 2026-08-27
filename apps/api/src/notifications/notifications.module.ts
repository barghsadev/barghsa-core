import { Module } from '@nestjs/common'
import { NotificationsController } from './notifications.controller.js'
import { NotificationsService } from './notifications.service.js'
import { NotificationTemplateService } from './notification-template.service.js'
import { NotificationCenterController } from './notification-center.controller.js'
import { NotificationCenterService } from './notification-center.service.js'
import { SessionModule } from '../session/index.js'

@Module({
  controllers: [NotificationsController, NotificationCenterController],
  providers: [
    NotificationsService,
    NotificationTemplateService,
    NotificationCenterService,
  ],
  imports: [SessionModule],
  exports: [NotificationsService, NotificationTemplateService],
})
export class NotificationsModule {}
