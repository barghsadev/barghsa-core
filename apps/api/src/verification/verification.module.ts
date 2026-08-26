import { Module } from '@nestjs/common'
import { VerificationProviderService } from './verification-provider.service.js'
import { VerificationProviderController } from './verification-provider.controller.js'

@Module({
  controllers: [VerificationProviderController],
  providers: [VerificationProviderService],
  exports: [VerificationProviderService],
})
export class VerificationModule {}