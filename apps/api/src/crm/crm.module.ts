import { AuthModule } from '../auth/auth.module.js';
import { AccountRecoveryService } from './account-recovery.service.js';
import {
  AccountRecoveryController,
  RecoveryContactController,
} from './account-recovery.controller.js';
import { CrmLegalDocumentsController } from './crm-legal-documents.controller.js';
import { VerifiedAttachmentsService } from '../storage/verified-attachments.service.js';
import { VerificationEvidenceService } from './verification-evidence.service.js';
import { StaffAssignmentModule } from '../staff-assignment/staff-assignment.module.js';
import { Module } from '@nestjs/common';
import { CrmController } from './crm.controller.js';
import { CrmV2Controller } from './crm-v2.controller.js';
import { VerificationCaseController } from './verification-case.controller.js';
import { CrmService } from './crm.service.js';
import { CrmV2Service } from './crm-v2.service.js';
import { VerificationCaseService } from './verification-case.service.js';
import { SessionModule } from '../session/session.module.js';
import { NotificationsModule } from '../notifications/index.js';

@Module({
  imports: [AuthModule, StaffAssignmentModule, SessionModule, NotificationsModule],
  controllers: [
    AccountRecoveryController,
    RecoveryContactController,
    CrmLegalDocumentsController,
    CrmController,
    CrmV2Controller,
    VerificationCaseController,
  ],
  providers: [
    AccountRecoveryService,
    VerifiedAttachmentsService,
    VerificationEvidenceService,
    CrmService,
    CrmV2Service,
    VerificationCaseService,
  ],
  exports: [CrmService, CrmV2Service, VerificationCaseService],
})
export class CrmModule {}
