import { Module } from '@nestjs/common'
import { WalletController } from './wallet.controller.js'
import { WalletService } from './wallet.service.js'
import { SessionModule } from '../session/index.js'
import { ProfilesModule } from '../profiles/index.js'

@Module({
  imports: [SessionModule, ProfilesModule],
  controllers: [WalletController],
  providers: [WalletService],
  exports: [WalletService],
})
export class WalletModule {}
