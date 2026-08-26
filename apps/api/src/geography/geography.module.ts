import { Module } from '@nestjs/common'
import { GeographyController } from './geography.controller.js'
import { GeographyService } from './geography.service.js'
import { AdminGeographyController } from './admin-geography.controller.js'
import { AdminGeographyService } from './admin-geography.service.js'
import { SessionModule } from '../session/session.module.js'

@Module({
  imports: [SessionModule],
  controllers: [GeographyController, AdminGeographyController],
  providers: [GeographyService, AdminGeographyService],
  exports: [GeographyService, AdminGeographyService],
})
export class GeographyModule {}