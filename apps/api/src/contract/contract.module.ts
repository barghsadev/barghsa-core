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
  controllers: [ContractController, ContractReviewController, CustomerContractController],
  providers: [ContractService, ContractReviewService],
  exports: [ContractService],
})
export class ContractModule {}
