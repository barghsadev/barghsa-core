import { Module } from '@nestjs/common'
import { GeographyController } from './geography.controller.js'
import { GeographyService } from './geography.service.js'
import { SessionModule } from '../session/session.module.js'

@Module({
  imports: [SessionModule],
  controllers: [GeographyController],
  providers: [GeographyService],
  exports: [GeographyService],
})
export class GeographyModule {}