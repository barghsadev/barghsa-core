import { ContractActivationService } from './contract-activation.service.js';
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
@Module({
  imports: [SessionModule],
  controllers: [
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
    ContractService,
    ContractReviewService,
    ContractSignatureService,
    ContractActivationService,
  ],
  exports: [ContractService],
})
export class ContractModule {}
