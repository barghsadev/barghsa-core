import { Module } from '@nestjs/common'
import { DashboardController } from './dashboard.controller.js'
import { SessionModule } from '../session/index.js'

@Module({
  controllers: [DashboardController],
  imports: [SessionModule],
})
export class DashboardModule {}