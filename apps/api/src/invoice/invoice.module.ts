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

@Module({
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
  ],
})
export class InvoiceModule {}
