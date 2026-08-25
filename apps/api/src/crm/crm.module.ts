import { Module } from '@nestjs/common'
import { CrmController } from './crm.controller.js'
import { CrmV2Controller } from './crm-v2.controller.js'
import { VerificationCaseController } from './verification-case.controller.js'
import { CrmService } from './crm.service.js'
import { CrmV2Service } from './crm-v2.service.js'
import { VerificationCaseService } from './verification-case.service.js'
import { SessionModule } from '../session/session.module.js'

@Module({
  imports: [SessionModule],
  controllers: [CrmController, CrmV2Controller, VerificationCaseController],
  providers: [CrmService, CrmV2Service, VerificationCaseService],
  exports: [CrmService, CrmV2Service, VerificationCaseService],
})
export class CrmModule {}