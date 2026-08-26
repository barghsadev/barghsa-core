import { Module } from '@nestjs/common'
import { TicketsController } from './tickets.controller.js'
import { TicketsService } from './tickets.service.js'
import { SessionModule } from '../session/session.module.js'

@Module({
  imports: [SessionModule],
  controllers: [TicketsController],
  providers: [TicketsService],
  exports: [TicketsService],
})
export class TicketsModule {}