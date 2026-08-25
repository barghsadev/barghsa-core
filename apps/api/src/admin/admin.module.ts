import { Module } from '@nestjs/common'
import { SessionModule } from '../session/session.module.js'
import { AdminController } from './admin.controller.js'
import { AdminService } from './admin.service.js'

@Module({
  imports: [SessionModule],
  controllers: [AdminController],
  providers: [AdminService],
  exports: [AdminService],
})
export class AdminModule {}