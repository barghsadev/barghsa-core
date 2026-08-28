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
import { FailedNotificationsService } from './failed-notifications.service.js'
import { FailedNotificationsController } from './failed-notifications.controller.js'
import { VatConfigService } from './vat-config.service.js'
import { VatConfigController } from './vat-config.controller.js'
import { GiftCodeService } from './gift-code.service.js'
import { GiftCodeController } from './gift-code.controller.js'
import { ContractTemplateService } from './contract-template.service.js'
import { ContractTemplateController } from './contract-template.controller.js'
import { TosModule } from '../tos/tos.module.js'
import { CorrelationIdProvider } from '../common/index.js'

@Module({
  imports: [SessionModule, forwardRef(() => TosModule), NotificationsModule],
  controllers: [
    AdminController,
    DualApprovalController,
    ReconciliationExceptionsController,
    FailedJobsController,
    FailedNotificationsController,
    VatConfigController,
    GiftCodeController,
    ContractTemplateController,
  ],
  providers: [
    AdminService,
    BrandConfigService,
    DualApprovalService,
    ReconciliationExceptionsService,
    FailedJobsService,
    FailedNotificationsService,
    VatConfigService,
    GiftCodeService,
    ContractTemplateService,
    CorrelationIdProvider,
  ],
  exports: [AdminService, BrandConfigService, DualApprovalService, ReconciliationExceptionsService, FailedJobsService, FailedNotificationsService, VatConfigService, GiftCodeService],
})
export class AdminModule {}
