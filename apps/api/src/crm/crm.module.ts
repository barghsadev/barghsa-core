import { Module } from '@nestjs/common'
import { CrmController } from './crm.controller.js'
import { CrmV2Controller } from './crm-v2.controller.js'
import { CrmService } from './crm.service.js'
import { CrmV2Service } from './crm-v2.service.js'
import { SessionModule } from '../session/session.module.js'

@Module({
  imports: [SessionModule],
  controllers: [CrmController, CrmV2Controller],
  providers: [CrmService, CrmV2Service],
  exports: [CrmService, CrmV2Service],
})
export class CrmModule {}