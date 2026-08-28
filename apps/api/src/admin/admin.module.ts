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
import { FailedJobsService } from './failed-jobs.service.js'
import { FailedJobsController } from './failed-jobs.controller.js'
import { TosModule } from '../tos/tos.module.js'

@Module({
  imports: [SessionModule, forwardRef(() => TosModule), NotificationsModule],
  controllers: [
    AdminController,
    DualApprovalController,
    ReconciliationExceptionsController,
    FailedJobsController,
  ],
  providers: [
    AdminService,
    BrandConfigService,
    DualApprovalService,
    ReconciliationExceptionsService,
    FailedJobsService,
  ],
  exports: [AdminService, BrandConfigService, DualApprovalService, ReconciliationExceptionsService, FailedJobsService],
})
export class AdminModule {}
