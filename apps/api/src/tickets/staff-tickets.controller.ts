import {
  Body,
  Controller,
  Post,
  Get,
  Patch,
  Put,
  Param,
  Query,
  HttpCode,
  HttpException,
  Logger,
  Req,
  UseGuards,
} from '@nestjs/common'
import { ApiOperation, ApiResponse, ApiQuery, ApiTags } from '@nestjs/swagger'
import { TicketsService, type ListTicketsOptions } from './tickets.service.js'
import { SessionAuthGuard } from '../session/session.guard.js'
import type { AuthenticatedRequest } from '../session/session.guard.js'
import { RateLimit } from '../rate-limit/rate-limit.decorator.js'

@ApiTags('Staff Tickets')
@Controller('api/staff/tickets')
@UseGuards(SessionAuthGuard)
export class StaffTicketsController {
  private readonly logger = new Logger(StaffTicketsController.name)

  constructor(private readonly ticketsService: TicketsService) {}

  /**
   * GET /api/staff/tickets
   *
   * Staff list all tickets with pagination, status filter, search,
   * and assignedTo filter. Requires staff/admin role.
   */
  @Get()
  @RateLimit({ namespace: 'staff:tickets:list', limit: 120, windowMs: 60_000 })
  @ApiOperation({ summary: 'Staff list all tickets' })
  @ApiQuery({ name: 'page', required: false, description: 'Page number (default: 1)' })
  @ApiQuery({ name: 'limit', required: false, description: 'Items per page (default: 20, max: 100)' })
  @ApiQuery({ name: 'status', required: false, description: 'Filter by status' })
  @ApiQuery({ name: 'search', required: false, description: 'Search in subject and body' })
  @ApiQuery({ name: 'assignedTo', required: false, description: 'Filter by assigned staff user ID' })
  @ApiQuery({ name: 'sortBy', required: false, description: 'Sort column (created_at, updated_at, subject, status, priority)' })
  @ApiQuery({ name: 'sortOrder', required: false, description: 'Sort order (asc or desc)' })
  @ApiResponse({ status: 200, description: 'Paginated ticket list.' })
  @ApiResponse({ status: 403, description: 'Not staff' })
  async listTickets(
    @Req() req: AuthenticatedRequest,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('status') status?: string,
    @Query('search') search?: string,
    @Query('assignedTo') assignedTo?: string,
    @Query('sortBy') sortBy?: string,
    @Query('sortOrder') sortOrder?: 'asc' | 'desc',
  ) {
    if (!req.session.isAdmin) {
      throw new HttpException(
        { statusCode: 403, error: 'FORBIDDEN', message: 'Only staff can access this endpoint' },
        403,
      )
    }

    const options: Partial<ListTicketsOptions & { assignedTo?: string }> = {}
    if (page !== undefined) {
      const parsed = Number(page)
      if (Number.isFinite(parsed)) options.page = parsed
    }
    if (limit !== undefined) {
      const parsed = Number(limit)
      if (Number.isFinite(parsed)) options.limit = parsed
    }
    if (status !== undefined) options.status = status
    if (search !== undefined) options.search = search
    if (assignedTo !== undefined) options.assignedTo = assignedTo
    if (sortBy !== undefined) options.sortBy = sortBy
    if (sortOrder !== undefined) options.sortOrder = sortOrder

    return this.ticketsService.staffListTickets(options)
  }

  /**
   * GET /api/staff/tickets/:id
   *
   * Staff view any ticket detail (no user scoping).
   */
  @Get(':id')
  @ApiOperation({ summary: 'Staff get ticket detail' })
  @ApiResponse({ status: 200, description: 'Ticket detail.' })
  @ApiResponse({ status: 403, description: 'Not staff' })
  @ApiResponse({ status: 404, description: 'Ticket not found' })
  async getTicket(
    @Param('id') id: string,
    @Req() req: AuthenticatedRequest,
  ) {
    if (!req.session.isAdmin) {
      throw new HttpException(
        { statusCode: 403, error: 'FORBIDDEN', message: 'Only staff can access this endpoint' },
        403,
      )
    }
    return this.ticketsService.staffGetTicket(id)
  }

  /**
   * PUT /api/staff/tickets/:id/assign
   *
   * Staff assign a ticket to themselves (or another staff member).
   * If the ticket is 'open', it transitions to 'in_progress'.
   */
  @Put(':id/assign')
  @HttpCode(200)
  @RateLimit({ namespace: 'staff:tickets:assign', limit: 60, windowMs: 60_000 })
  @ApiOperation({ summary: 'Assign ticket to staff' })
  @ApiResponse({ status: 200, description: 'Ticket assigned.' })
  @ApiResponse({ status: 403, description: 'Not staff' })
  @ApiResponse({ status: 404, description: 'Ticket not found' })
  async assignTicket(
    @Param('id') id: string,
    @Body() body: { assigneeId?: string },
    @Req() req: AuthenticatedRequest,
  ) {
    if (!req.session.isAdmin) {
      throw new HttpException(
        { statusCode: 403, error: 'FORBIDDEN', message: 'Only staff can assign tickets' },
        403,
      )
    }
    // Default to self-assignment if no assigneeId provided
    const assigneeId = body.assigneeId ?? req.session.userId
    return this.ticketsService.staffAssignTicket(id, assigneeId)
  }

  /**
   * PATCH /api/staff/tickets/:id/status
   *
   * Staff update the status of any ticket.
   */
  @Patch(':id/status')
  @ApiOperation({ summary: 'Staff update ticket status' })
  @ApiResponse({ status: 200, description: 'Status updated.' })
  @ApiResponse({ status: 400, description: 'Invalid status' })
  @ApiResponse({ status: 403, description: 'Not staff' })
  @ApiResponse({ status: 404, description: 'Ticket not found' })
  async updateTicketStatus(
    @Param('id') id: string,
    @Body() body: { status: string },
    @Req() req: AuthenticatedRequest,
  ) {
    if (!req.session.isAdmin) {
      throw new HttpException(
        { statusCode: 403, error: 'FORBIDDEN', message: 'Only staff can update ticket status' },
        403,
      )
    }
    return this.ticketsService.staffUpdateTicketStatus(id, body.status)
  }

  /**
   * GET /api/staff/tickets/:id/comments
   *
   * Staff list all comments on a ticket (including internal notes).
   */
  @Get(':id/comments')
  @ApiOperation({ summary: 'Staff list ticket comments' })
  @ApiResponse({ status: 200, description: 'Comment list.' })
  @ApiResponse({ status: 403, description: 'Not staff' })
  @ApiResponse({ status: 404, description: 'Ticket not found' })
  async listComments(
    @Param('id') id: string,
    @Req() req: AuthenticatedRequest,
  ) {
    if (!req.session.isAdmin) {
      throw new HttpException(
        { statusCode: 403, error: 'FORBIDDEN', message: 'Only staff can access this endpoint' },
        403,
      )
    }
    return this.ticketsService.staffListComments(id)
  }

  /**
   * POST /api/staff/tickets/:id/comments
   *
   * Staff add a comment to any ticket (public or internal).
   */
  @Post(':id/comments')
  @HttpCode(201)
  @RateLimit({ namespace: 'staff:tickets:comment', limit: 40, windowMs: 60_000 })
  @ApiOperation({ summary: 'Staff add a comment to a ticket' })
  @ApiResponse({ status: 201, description: 'Comment added.' })
  @ApiResponse({ status: 400, description: 'Validation error' })
  @ApiResponse({ status: 403, description: 'Not staff' })
  @ApiResponse({ status: 404, description: 'Ticket not found' })
  async addComment(
    @Param('id') id: string,
    @Body() body: {
      body: string
      visibility?: 'public' | 'internal'
    },
    @Req() req: AuthenticatedRequest,
  ) {
    if (!req.session.isAdmin) {
      throw new HttpException(
        { statusCode: 403, error: 'FORBIDDEN', message: 'Only staff can access this endpoint' },
        403,
      )
    }
    const visibility = body.visibility ?? 'public'
    return this.ticketsService.staffAddComment(id, req.session.userId, body.body, visibility)
  }
}