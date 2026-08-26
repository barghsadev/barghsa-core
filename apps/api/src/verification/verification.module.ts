import { Module } from '@nestjs/common'
import { VerificationProviderService } from './verification-provider.service.js'
import { VerificationProviderController } from './verification-provider.controller.js'
import { SessionModule } from '../session/index.js'
import { NotificationsModule } from '../notifications/index.js'

@Module({
  controllers: [VerificationProviderController],
  providers: [VerificationProviderService],
  imports: [SessionModule, NotificationsModule],
  exports: [VerificationProviderService],
})
export class VerificationModule {}