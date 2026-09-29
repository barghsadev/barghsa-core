import { ExternalRefundController } from './external-refund.controller.js';
import { Module } from '@nestjs/common';
import { SessionModule } from '../session/session.module.js';
import { InvoiceModule } from '../invoice/invoice.module.js';
import { WalletRefundController } from './wallet-refund.controller.js';
import { RefundService } from './refund.service.js';
import { ReviewSnapshotService } from '../finance/review-snapshot.service.js';
@Module({
  imports: [SessionModule, InvoiceModule],
  controllers: [WalletRefundController, ExternalRefundController],
  providers: [RefundService, ReviewSnapshotService],
  exports: [RefundService],
})
export class RefundModule {}
