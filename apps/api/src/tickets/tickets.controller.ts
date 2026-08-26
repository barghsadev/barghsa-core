import {
  Body,
  Controller,
  Post,
  HttpCode,
  Logger,
  Req,
  UseGuards,
} from '@nestjs/common'
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger'
import { TicketsService } from './tickets.service.js'
import { SessionAuthGuard } from '../session/session.guard.js'
import type { AuthenticatedRequest } from '../session/session.guard.js'
import { RateLimit } from '../rate-limit/rate-limit.decorator.js'

@ApiTags('Tickets')
@Controller('api/tickets')
@UseGuards(SessionAuthGuard)
export class TicketsController {
  private readonly logger = new Logger(TicketsController.name)

  constructor(private readonly ticketsService: TicketsService) {}

  /**
   * POST /api/tickets
   *
   * Creates a new support ticket for the authenticated user.
   * Optionally scoped to a profile and related entity.
   */
  @Post()
  @HttpCode(201)
  @RateLimit({ namespace: 'tickets:create:user', limit: 10, windowMs: 60_000 })
  @ApiOperation({ summary: 'Create a support ticket' })
  @ApiResponse({ status: 201, description: 'Ticket created.' })
  @ApiResponse({ status: 400, description: 'Validation error' })
  @ApiResponse({ status: 401, description: 'Not authenticated' })
  @ApiResponse({ status: 404, description: 'Profile not found' })
  async createTicket(
    @Body() body: {
      subject: string
      body: string
      profileId?: string
      relatedEntityType?: 'order' | 'contract' | 'invoice'
      relatedEntityId?: string
      priority?: 'normal' | 'high'
      /** Storage keys of previously uploaded files. */
      attachments?: string[]
    },
    @Req() req: AuthenticatedRequest,
  ) {
    const userId = req.session.userId

    const ticket = await this.ticketsService.createTicket(userId, {
      subject: body.subject,
      body: body.body,
      profileId: body.profileId ?? null,
      relatedEntityType: body.relatedEntityType ?? null,
      relatedEntityId: body.relatedEntityId ?? null,
      priority: body.priority ?? 'normal',
      attachments: body.attachments ?? null,
    })

    this.logger.log(`Ticket ${ticket.id} created for user ${userId}`)
    return ticket
  }
}