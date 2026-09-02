import { Module } from '@nestjs/common'
import { WalletController } from './wallet.controller.js'
import { WalletService } from './wallet.service.js'
import { OnlineTopUpService } from './online-topup.service.js'
import { BankReceiptTopUpService } from './bank-receipt-topup.service.js'
import { BankReceiptConfirmationService } from './bank-receipt-confirmation.service.js'
import { PayInvoiceWithWalletService } from './pay-invoice-with-wallet.service.js'
import { OnlineTopUpCallbackController } from './online-topup-callback.controller.js'
import { OnlineTopUpCallbackService } from './online-topup-callback.service.js'
import { ChargebackDetectionController } from './chargeback-detection.controller.js'
import { ChargebackDetectionService } from './chargeback-detection.service.js'
import { ChargebackAlertService } from './chargeback-alert.service.js'
import { PAYMENT_GATEWAY, createPaymentGatewayFromEnv } from './payment-gateway.js'
import { SessionModule } from '../session/index.js'
import { ProfilesModule } from '../profiles/index.js'
import { InvoiceModule } from '../invoice/invoice.module.js'

@Module({
  imports: [SessionModule, ProfilesModule, InvoiceModule],
  controllers: [WalletController, OnlineTopUpCallbackController, ChargebackDetectionController],
  providers: [
    WalletService,
    OnlineTopUpService,
    BankReceiptTopUpService,
    BankReceiptConfirmationService,
    PayInvoiceWithWalletService,
    OnlineTopUpCallbackService,
    ChargebackDetectionService,
    ChargebackAlertService,
    {
      provide: PAYMENT_GATEWAY,
      useFactory: () => createPaymentGatewayFromEnv(),
    },
  ],
  exports: [
    WalletService,
    BankReceiptConfirmationService,
    PayInvoiceWithWalletService,
    ChargebackAlertService,
  ],
})
export class WalletModule {}
