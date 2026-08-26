import { Module } from '@nestjs/common'
import { SessionModule } from '../session/session.module.js'
import { AdminController } from './admin.controller.js'
import { AdminService } from './admin.service.js'
import { BrandConfigService } from './brand-config.service.js'

@Module({
  imports: [SessionModule],
  controllers: [AdminController],
  providers: [AdminService, BrandConfigService],
  exports: [AdminService, BrandConfigService],
})
export class AdminModule {}