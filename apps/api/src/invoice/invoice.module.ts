import { Module } from '@nestjs/common'
import { InvoiceStateMachineService } from './invoice-state-machine.service.js'
import { InvoiceAuditRepository } from './invoice-audit.repository.js'
import { ManualInvoiceService } from './manual-invoice.service.js'

@Module({
  providers: [InvoiceStateMachineService, InvoiceAuditRepository, ManualInvoiceService],
  exports: [InvoiceStateMachineService, InvoiceAuditRepository, ManualInvoiceService],
})
export class InvoiceModule {}
