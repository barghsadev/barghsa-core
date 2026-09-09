import { ticketListQuery } from './ticket-input.js';
import {
  Body,
  Controller,
  Post,
  Get,
  Patch,
  Param,
  ParseUUIDPipe,
  Query,
  HttpCode,
  HttpException,
  Logger,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiQuery, ApiTags } from '@nestjs/swagger';
import { TicketsService } from './tickets.service.js';
import { SessionAuthGuard } from '../session/session.guard.js';
import type { AuthenticatedRequest } from '../session/session.guard.js';
import { RateLimit } from '../rate-limit/rate-limit.decorator.js';

@ApiTags('Tickets')
@Controller('api/tickets')
@UseGuards(SessionAuthGuard)
export class TicketsController {
  private readonly logger = new Logger(TicketsController.name);

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
    @Body()
    body: {
      subject: string;
      body: string;
      profileId?: string;
      relatedEntityType?: 'order' | 'contract' | 'invoice';
      relatedEntityId?: string;
      priority?: 'normal' | 'high';
      /** Storage keys of previously uploaded files. */
      attachments?: string[];
    },
    @Req() req: AuthenticatedRequest
  ) {
    const userId = req.session.userId;

    const ticket = await this.ticketsService.createTicket(userId, body, req.session);

    this.logger.log(`Ticket ${ticket.id} created for user ${userId}`);
    return ticket;
  }

  /**
   * GET /api/tickets
   *
   * Lists tickets for the authenticated user with pagination,
   * status filter, and search.
   */
  @Get()
  @RateLimit({ namespace: 'tickets:list:user', limit: 60, windowMs: 60_000 })
  @ApiOperation({ summary: 'List user tickets' })
  @ApiQuery({ name: 'page', required: false, description: 'Page number (default: 1)' })
  @ApiQuery({
    name: 'limit',
    required: false,
    description: 'Items per page (default: 20, max: 100)',
  })
  @ApiQuery({ name: 'status', required: false, description: 'Filter by status' })
  @ApiQuery({ name: 'search', required: false, description: 'Search in subject and body' })
  @ApiQuery({
    name: 'sortBy',
    required: false,
    description: 'Sort column (created_at, updated_at, subject, status, priority)',
  })
  @ApiQuery({ name: 'sortOrder', required: false, description: 'Sort order (asc or desc)' })
  @ApiResponse({ status: 200, description: 'Paginated ticket list.' })
  @ApiResponse({ status: 401, description: 'Not authenticated' })
  async listTickets(
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('status') status?: string,
    @Query('search') search?: string,
    @Query('sortBy') sortBy?: string,
    @Query('sortOrder') sortOrder?: 'asc' | 'desc',
    @Req() req?: AuthenticatedRequest
  ) {
    const options = ticketListQuery({ page, limit, status, search, sortBy, sortOrder });
    return this.ticketsService.listTickets(req!.session.userId, options);
  }

  /**
   * GET /api/tickets/:id
   *
   * Gets a single ticket detail, scoped to the authenticated user.
   */
  @Get('options')
  async creationOptions(
    @Req() req: AuthenticatedRequest,
    @Query('profileId') profileId?: string,
    @Query('recordPage') recordPage?: string
  ) {
    return this.ticketsService.creationOptions(
      req.session.userId,
      profileId,
      recordPage === undefined ? 1 : Number(recordPage)
    );
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get ticket detail' })
  @ApiResponse({ status: 200, description: 'Ticket detail.' })
  @ApiResponse({ status: 401, description: 'Not authenticated' })
  @ApiResponse({ status: 404, description: 'Ticket not found' })
  async getTicket(@Param('id', new ParseUUIDPipe()) id: string, @Req() req: AuthenticatedRequest) {
    return this.ticketsService.getTicket(id, req.session.userId);
  }

  /**
   * PATCH /api/tickets/:id/status
   *
   * Updates the status of a ticket. The user must own the ticket.
   */
  @Patch(':id/status')
  @ApiOperation({ summary: 'Update ticket status' })
  @ApiResponse({ status: 200, description: 'Status updated.' })
  @ApiResponse({ status: 400, description: 'Invalid status' })
  @ApiResponse({ status: 401, description: 'Not authenticated' })
  @ApiResponse({ status: 404, description: 'Ticket not found' })
  async updateTicketStatus(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: { status: string },
    @Req() req: AuthenticatedRequest
  ) {
    return this.ticketsService.updateTicketStatus(
      id,
      req.session.userId,
      body?.status,
      false,
      req.session
    );
  }

  /**
   * GET /api/tickets/:id/comments
   *
   * Lists comments on a ticket. Customers see only public comments.
   */
  @Get(':id/comments')
  @ApiOperation({ summary: 'List ticket comments' })
  @ApiResponse({ status: 200, description: 'Comment list.' })
  @ApiResponse({ status: 401, description: 'Not authenticated' })
  @ApiResponse({ status: 404, description: 'Ticket not found' })
  async listComments(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Req() req: AuthenticatedRequest
  ) {
    return this.ticketsService.listComments(id, req.session.userId, false);
  }

  /**
   * POST /api/tickets/:id/comments
   *
   * Adds a comment to a ticket. The user must own the ticket.
   * Customers can only add public comments.
   * Staff use the separate staff endpoint for internal notes.
   */
  @Post(':id/comments')
  @HttpCode(201)
  @RateLimit({ namespace: 'tickets:comment:create', limit: 20, windowMs: 60_000 })
  @ApiOperation({ summary: 'Add a comment to a ticket' })
  @ApiResponse({ status: 201, description: 'Comment added.' })
  @ApiResponse({ status: 400, description: 'Validation error' })
  @ApiResponse({ status: 401, description: 'Not authenticated' })
  @ApiResponse({ status: 404, description: 'Ticket not found' })
  async addComment(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body()
    body: {
      body: string;
      visibility?: 'public' | 'internal';
    },
    @Req() req: AuthenticatedRequest
  ) {
    // Internal notes belong only to the staff endpoint.
    const visibility = body?.visibility ?? 'public';
    if (visibility === 'internal') {
      throw new HttpException(
        { statusCode: 403, error: 'FORBIDDEN', message: 'Only staff can add internal notes' },
        403
      );
    }
    return this.ticketsService.addComment(
      id,
      req.session.userId,
      body?.body,
      visibility,
      false,
      req.session
    );
  }
}
