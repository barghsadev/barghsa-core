import { Module } from '@nestjs/common'
import { InvoiceStateMachineService } from './invoice-state-machine.service.js'
import { InvoiceAuditRepository } from './invoice-audit.repository.js'
import { ManualInvoiceService } from './manual-invoice.service.js'
import { AutoInvoiceService } from './auto-invoice.service.js'
import { VatCalculationRepository } from './vat-calculation.repository.js'
import { VatCalculationService } from './vat-calculation.service.js'
import { RoundingService } from './rounding.service.js'
import { DueAtCalculationRepository } from './due-at.repository.js'
import { DueAtCalculationService } from './due-at.service.js'
import { DueAtOverrideService } from './due-at-override.service.js'
import { CancelAndReplaceInvoiceService } from './cancel-and-replace-invoice.service.js'
import { CreateAdjustmentInvoiceService } from './create-adjustment-invoice.service.js'
import { CustomerInvoiceDetailsService } from './customer-invoice-details.service.js'
import { CustomerInvoiceController } from './customer-invoice.controller.js'
import { SessionModule } from '../session/session.module.js'

@Module({
  imports: [SessionModule],
  controllers: [CustomerInvoiceController],
  providers: [
    InvoiceStateMachineService,
    InvoiceAuditRepository,
    ManualInvoiceService,
    AutoInvoiceService,
    VatCalculationRepository,
    VatCalculationService,
    RoundingService,
    DueAtCalculationRepository,
    DueAtCalculationService,
    DueAtOverrideService,
    CancelAndReplaceInvoiceService,
    CreateAdjustmentInvoiceService,
    CustomerInvoiceDetailsService,
  ],
  exports: [
    InvoiceStateMachineService,
    InvoiceAuditRepository,
    ManualInvoiceService,
    AutoInvoiceService,
    VatCalculationRepository,
    VatCalculationService,
    RoundingService,
    DueAtCalculationRepository,
    DueAtCalculationService,
    DueAtOverrideService,
    CancelAndReplaceInvoiceService,
    CreateAdjustmentInvoiceService,
    CustomerInvoiceDetailsService,
  ],
})
export class InvoiceModule {}
