import { Module, forwardRef } from '@nestjs/common'
import { SessionModule } from '../session/session.module.js'
import { NotificationsModule } from '../notifications/index.js'
import { AdminController } from './admin.controller.js'
import { AdminService } from './admin.service.js'
import { BrandConfigService } from './brand-config.service.js'
import { DualApprovalService } from './dual-approval.service.js'
import { DualApprovalController } from './dual-approval.controller.js'
import { ReconciliationExceptionsService } from './reconciliation-exceptions.service.js'
import { ReconciliationExceptionsController } from './reconciliation-exceptions.controller.js'
import { TosModule } from '../tos/tos.module.js'

@Module({
  imports: [SessionModule, forwardRef(() => TosModule), NotificationsModule],
  controllers: [
    AdminController,
    DualApprovalController,
    ReconciliationExceptionsController,
  ],
  providers: [
    AdminService,
    BrandConfigService,
    DualApprovalService,
    ReconciliationExceptionsService,
  ],
  exports: [AdminService, BrandConfigService, DualApprovalService, ReconciliationExceptionsService],
})
export class AdminModule {}