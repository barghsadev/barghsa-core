import { Module, forwardRef } from '@nestjs/common'
import { SessionModule } from '../session/session.module.js'
import { NotificationsModule } from '../notifications/index.js'
import { AdminController } from './admin.controller.js'
import { AdminService } from './admin.service.js'
import { BrandConfigService } from './brand-config.service.js'
import { TosModule } from '../tos/tos.module.js'

@Module({
  imports: [SessionModule, forwardRef(() => TosModule), NotificationsModule],
  controllers: [AdminController],
  providers: [AdminService, BrandConfigService],
  exports: [AdminService, BrandConfigService],
})
export class AdminModule {}