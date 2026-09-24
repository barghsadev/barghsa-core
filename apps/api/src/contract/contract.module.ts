import {
  StaffContractCancellationStatusController,
  CustomerContractCancellationStatusController,
} from './contract-cancellation-status.controller.js';
import { ContractActivationService } from './contract-activation.service.js';
import { InvoiceModule } from '../invoice/invoice.module.js';
import { AdminModule } from '../admin/admin.module.js';
import { ContractCancellationService } from './contract-cancellation.service.js';
import { ContractCancellationRequestService } from './contract-cancellation-request.service.js';
import {
  CustomerCancellationRequestController,
  StaffCancellationRequestController,
} from './contract-cancellation-request.controller.js';
import { ContractCancellationController } from './contract-cancellation.controller.js';
import {
  ContractActivationRulesController,
  StaffContractActivationController,
  CustomerContractActivationController,
} from './contract-activation.controller.js';
import {
  ContractSignatureController,
  CustomerContractSignatureController,
} from './contract-signature.controller.js';
import { ContractSignatureService } from './contract-signature.service.js';
import {
  ContractReviewController,
  CustomerContractController,
} from './contract-review.controller.js';
import { ContractReviewService } from './contract-review.service.js';
import { Module } from '@nestjs/common';
import { SessionModule } from '../session/session.module.js';
import { ContractController } from './contract.controller.js';
import { ContractService } from './contract.service.js';
import { ContractPdfService } from './contract-pdf.service.js';
import { DocumentModule } from '../documents/document.module.js';
@Module({
  imports: [SessionModule, InvoiceModule, AdminModule, DocumentModule],
  controllers: [
    CustomerCancellationRequestController,
    StaffCancellationRequestController,
    StaffContractCancellationStatusController,
    CustomerContractCancellationStatusController,
    ContractCancellationController,
    ContractActivationRulesController,
    StaffContractActivationController,
    CustomerContractActivationController,
    ContractSignatureController,
    CustomerContractSignatureController,
    ContractController,
    ContractReviewController,
    CustomerContractController,
  ],
  providers: [
    ContractCancellationRequestService,
    ContractCancellationService,
    ContractService,
    ContractPdfService,
    ContractReviewService,
    ContractSignatureService,
    ContractActivationService,
  ],
  exports: [ContractService, ContractPdfService],
})
export class ContractModule {}
