import { Module } from '@nestjs/common'
import { WalletController } from './wallet.controller.js'
import { WalletService } from './wallet.service.js'
import { OnlineTopUpService } from './online-topup.service.js'
import { PAYMENT_GATEWAY, createRedirectPaymentGateway } from './payment-gateway.js'
import { SessionModule } from '../session/index.js'
import { ProfilesModule } from '../profiles/index.js'

@Module({
  imports: [SessionModule, ProfilesModule],
  controllers: [WalletController],
  providers: [
    WalletService,
    OnlineTopUpService,
    {
      provide: PAYMENT_GATEWAY,
      useFactory: () => createRedirectPaymentGateway(),
    },
  ],
  exports: [WalletService],
})
export class WalletModule {}
