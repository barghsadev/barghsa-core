import { ExternalRefundController } from './external-refund.controller.js';
import { Module } from '@nestjs/common';
import { SessionModule } from '../session/session.module.js';
import { InvoiceModule } from '../invoice/invoice.module.js';
import { WalletRefundController } from './wallet-refund.controller.js';
import { RefundService } from './refund.service.js';
@Module({
  imports: [SessionModule, InvoiceModule],
  controllers: [WalletRefundController, ExternalRefundController],
  providers: [RefundService],
  exports: [RefundService],
})
export class RefundModule {}
