import { TicketAttachmentsService } from './ticket-attachments.service.js'
import { NotificationsModule } from '../notifications/notifications.module.js'
import { StaffAssignmentModule } from '../staff-assignment/staff-assignment.module.js'
import { Module } from '@nestjs/common'
import { TicketsController } from './tickets.controller.js'
import { StaffTicketsController } from './staff-tickets.controller.js'
import { TicketsService } from './tickets.service.js'
import { SessionModule } from '../session/session.module.js'

@Module({
  imports: [StaffAssignmentModule, SessionModule, NotificationsModule],
  controllers: [TicketsController, StaffTicketsController],
  providers: [TicketsService, TicketAttachmentsService],
  exports: [TicketsService],
})
export class TicketsModule {}