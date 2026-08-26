import { Module } from '@nestjs/common'
import { DashboardController } from './dashboard.controller.js'
import { DashboardService } from './dashboard.service.js'
import { SessionModule } from '../session/index.js'

@Module({
  controllers: [DashboardController],
  providers: [DashboardService],
  imports: [SessionModule],
})
export class DashboardModule {}