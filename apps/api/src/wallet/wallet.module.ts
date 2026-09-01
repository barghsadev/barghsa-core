import { Module } from '@nestjs/common'
import { WalletController } from './wallet.controller.js'
import { WalletService } from './wallet.service.js'
import { OnlineTopUpService } from './online-topup.service.js'
import { BankReceiptTopUpService } from './bank-receipt-topup.service.js'
import { OnlineTopUpCallbackController } from './online-topup-callback.controller.js'
import { OnlineTopUpCallbackService } from './online-topup-callback.service.js'
import { PAYMENT_GATEWAY, createPaymentGatewayFromEnv } from './payment-gateway.js'
import { SessionModule } from '../session/index.js'
import { ProfilesModule } from '../profiles/index.js'

@Module({
  imports: [SessionModule, ProfilesModule],
  controllers: [WalletController, OnlineTopUpCallbackController],
  providers: [
    WalletService,
    OnlineTopUpService,
    BankReceiptTopUpService,
    OnlineTopUpCallbackService,
    {
      provide: PAYMENT_GATEWAY,
      useFactory: () => createPaymentGatewayFromEnv(),
    },
  ],
  exports: [WalletService],
})
export class WalletModule {}
