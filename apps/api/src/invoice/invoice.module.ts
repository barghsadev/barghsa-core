import { Module } from '@nestjs/common'
import { InvoiceStateMachineService } from './invoice-state-machine.service.js'

@Module({
  providers: [InvoiceStateMachineService],
  exports: [InvoiceStateMachineService],
})
export class InvoiceModule {}