import { Module } from '@nestjs/common'
import { TicketsController } from './tickets.controller.js'
import { StaffTicketsController } from './staff-tickets.controller.js'
import { TicketsService } from './tickets.service.js'
import { SessionModule } from '../session/session.module.js'

@Module({
  imports: [SessionModule],
  controllers: [TicketsController, StaffTicketsController],
  providers: [TicketsService],
  exports: [TicketsService],
})
export class TicketsModule {}