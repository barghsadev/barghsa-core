import { Module } from '@nestjs/common'
import { WalletController } from './wallet.controller.js'
import { WalletService } from './wallet.service.js'
import { SessionModule } from '../session/index.js'

@Module({
  imports: [SessionModule],
  controllers: [WalletController],
  providers: [WalletService],
  exports: [WalletService],
})
export class WalletModule {}
