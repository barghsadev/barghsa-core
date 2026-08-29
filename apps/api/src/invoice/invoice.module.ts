import { Module } from '@nestjs/common'
import { InvoiceStateMachineService } from './invoice-state-machine.service.js'
import { InvoiceAuditRepository } from './invoice-audit.repository.js'

@Module({
  providers: [InvoiceStateMachineService, InvoiceAuditRepository],
  exports: [InvoiceStateMachineService, InvoiceAuditRepository],
})
export class InvoiceModule {}
