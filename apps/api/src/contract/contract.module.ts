import { Module } from '@nestjs/common';
import { SessionModule } from '../session/session.module.js';
import { ContractController } from './contract.controller.js';
import { ContractService } from './contract.service.js';
@Module({
  imports: [SessionModule],
  controllers: [ContractController],
  providers: [ContractService],
  exports: [ContractService],
})
export class ContractModule {}
