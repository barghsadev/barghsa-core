import { ticketListQuery } from './ticket-input.js';
import { z } from 'zod';
import { hasStaffPermission } from '../session/staff-permissions.js';
import {
  Body,
  Controller,
  Post,
  Get,
  Patch,
  Put,
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

@ApiTags('Staff Tickets')
@Controller('api/staff/tickets')
@UseGuards(SessionAuthGuard)
export class StaffTicketsController {
  private readonly logger = new Logger(StaffTicketsController.name);

  constructor(private readonly ticketsService: TicketsService) {}

  private assignedScope(req: AuthenticatedRequest, action: 'read' | 'write'): string | undefined {
    return hasStaffPermission(req, `tickets:${action}`) || hasStaffPermission(req, 'tickets:*')
      ? undefined
      : req.session.userId;
  }

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
  @ApiQuery({
    name: 'limit',
    required: false,
    description: 'Items per page (default: 20, max: 100)',
  })
  @ApiQuery({ name: 'status', required: false, description: 'Filter by status' })
  @ApiQuery({ name: 'search', required: false, description: 'Search in subject and body' })
  @ApiQuery({
    name: 'assignedTo',
    required: false,
    description: 'Filter by assigned staff user ID',
  })
  @ApiQuery({
    name: 'sortBy',
    required: false,
    description: 'Sort column (created_at, updated_at, subject, status, priority)',
  })
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
    @Query('sortOrder') sortOrder?: 'asc' | 'desc'
  ) {
    if (
      !hasStaffPermission(req, 'tickets:read') &&
      !hasStaffPermission(req, 'tickets:*') &&
      !hasStaffPermission(req, 'tickets:assigned')
    ) {
      throw new HttpException(
        { statusCode: 403, error: 'FORBIDDEN', message: 'Only staff can access this endpoint' },
        403
      );
    }

    const options = ticketListQuery({ page, limit, status, search, sortBy, sortOrder, assignedTo });
    const scope = this.assignedScope(req, 'read');
    if (scope) options.assignedTo = scope;
    return {
      ...(await this.ticketsService.staffListTickets(options)),
      responseTargetHours: await this.ticketsService.responseTargetHours(),
      viewer: {
        userId: req.session.userId,
        canWrite:
          hasStaffPermission(req, 'tickets:write') ||
          hasStaffPermission(req, 'tickets:*') ||
          hasStaffPermission(req, 'tickets:assigned'),
        canAssignOthers: this.assignedScope(req, 'write') === undefined,
      },
    };
  }

  /**
   * GET /api/staff/tickets/:id
   *
   * Staff view any ticket detail (no user scoping).
   */
  @Get('teams')
  async teams(@Req() req: AuthenticatedRequest) {
    if (this.assignedScope(req, 'write') !== undefined)
      throw new HttpException('Only full ticket managers can choose teams', 403);
    return this.ticketsService.assignmentTeams();
  }

  @Get('assignees')
  async assignees(@Req() req: AuthenticatedRequest) {
    if (this.assignedScope(req, 'write') !== undefined)
      throw new HttpException('Only full ticket managers can choose other assignees', 403);
    return this.ticketsService.eligibleAssignees();
  }

  @Get(':id')
  @ApiOperation({ summary: 'Staff get ticket detail' })
  @ApiResponse({ status: 200, description: 'Ticket detail.' })
  @ApiResponse({ status: 403, description: 'Not staff' })
  @ApiResponse({ status: 404, description: 'Ticket not found' })
  async getTicket(@Param('id', new ParseUUIDPipe()) id: string, @Req() req: AuthenticatedRequest) {
    if (
      !hasStaffPermission(req, 'tickets:read') &&
      !hasStaffPermission(req, 'tickets:*') &&
      !hasStaffPermission(req, 'tickets:assigned')
    ) {
      throw new HttpException(
        { statusCode: 403, error: 'FORBIDDEN', message: 'Only staff can access this endpoint' },
        403
      );
    }
    return this.ticketsService.staffGetTicket(id, this.assignedScope(req, 'read'));
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
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: { assigneeId?: string; teamId?: string },
    @Req() req: AuthenticatedRequest
  ) {
    if (
      !hasStaffPermission(req, 'tickets:write') &&
      !hasStaffPermission(req, 'tickets:*') &&
      !hasStaffPermission(req, 'tickets:assigned')
    ) {
      throw new HttpException(
        { statusCode: 403, error: 'FORBIDDEN', message: 'Only staff can assign tickets' },
        403
      );
    }
    // Default to self-assignment if no assigneeId provided
    const parsed = z
      .object({
        assigneeId: z.string().trim().min(1).max(512).optional(),
        teamId: z.uuid().optional(),
      })
      .strict()
      .safeParse(body ?? {});
    if (!parsed.success) throw new HttpException('Invalid assignment', 400);
    const assigneeId = parsed.data.assigneeId ?? req.session.userId;
    const scope = this.assignedScope(req, 'write');
    if (scope && (assigneeId !== scope || parsed.data.teamId))
      throw new HttpException('Assigned-only staff cannot reassign another user', 403);
    return this.ticketsService.staffAssignTicket(
      id,
      assigneeId,
      req.session.userId,
      scope,
      parsed.data.teamId,
      req.session
    );
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
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: { status: string },
    @Req() req: AuthenticatedRequest
  ) {
    if (
      !hasStaffPermission(req, 'tickets:write') &&
      !hasStaffPermission(req, 'tickets:*') &&
      !hasStaffPermission(req, 'tickets:assigned')
    ) {
      throw new HttpException(
        { statusCode: 403, error: 'FORBIDDEN', message: 'Only staff can update ticket status' },
        403
      );
    }
    return this.ticketsService.staffUpdateTicketStatus(
      id,
      body?.status,
      req.session.userId,
      this.assignedScope(req, 'write'),
      req.session
    );
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
    @Param('id', new ParseUUIDPipe()) id: string,
    @Req() req: AuthenticatedRequest
  ) {
    if (
      !hasStaffPermission(req, 'tickets:read') &&
      !hasStaffPermission(req, 'tickets:*') &&
      !hasStaffPermission(req, 'tickets:assigned')
    ) {
      throw new HttpException(
        { statusCode: 403, error: 'FORBIDDEN', message: 'Only staff can access this endpoint' },
        403
      );
    }
    return this.ticketsService.staffListComments(id, this.assignedScope(req, 'read'));
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
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body()
    body: {
      body: string;
      visibility?: 'public' | 'internal';
    },
    @Req() req: AuthenticatedRequest
  ) {
    if (
      !hasStaffPermission(req, 'tickets:write') &&
      !hasStaffPermission(req, 'tickets:*') &&
      !hasStaffPermission(req, 'tickets:assigned')
    ) {
      throw new HttpException(
        { statusCode: 403, error: 'FORBIDDEN', message: 'Only staff can access this endpoint' },
        403
      );
    }
    const visibility = body?.visibility ?? 'public';
    return this.ticketsService.staffAddComment(
      id,
      req.session.userId,
      body?.body,
      visibility,
      this.assignedScope(req, 'write'),
      req.session
    );
  }
}
