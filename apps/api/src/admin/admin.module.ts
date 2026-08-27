import { Module, forwardRef } from '@nestjs/common'
import { SessionModule } from '../session/session.module.js'
import { NotificationsModule } from '../notifications/index.js'
import { AdminController } from './admin.controller.js'
import { AdminService } from './admin.service.js'
import { BrandConfigService } from './brand-config.service.js'
import { DualApprovalService } from './dual-approval.service.js'
import { DualApprovalController } from './dual-approval.controller.js'
import { TosModule } from '../tos/tos.module.js'

@Module({
  imports: [SessionModule, forwardRef(() => TosModule), NotificationsModule],
  controllers: [AdminController, DualApprovalController],
  providers: [AdminService, BrandConfigService, DualApprovalService],
  exports: [AdminService, BrandConfigService, DualApprovalService],
})
export class AdminModule {}