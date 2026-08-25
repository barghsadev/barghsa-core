import { Module } from '@nestjs/common'
import { CrmController } from './crm.controller.js'
import { CrmService } from './crm.service.js'
import { SessionModule } from '../session/session.module.js'

@Module({
  imports: [SessionModule],
  controllers: [CrmController],
  providers: [CrmService],
  exports: [CrmService],
})
export class CrmModule {}