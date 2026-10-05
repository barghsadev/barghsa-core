import { TicketReplySchema, ticketReplyApiSchema, ticketListQuery } from './ticket-input.js';
import { parseTicketFormInput } from './ticket-form-input-fields.js';
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
  ParseIntPipe,
  Header,
  StreamableFile,
  Query,
  HttpCode,
  HttpException,
  Logger,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiBody, ApiOperation, ApiResponse, ApiQuery, ApiTags } from '@nestjs/swagger';
import { TicketsService } from './tickets.service.js';
import { SessionAuthGuard } from '../session/session.guard.js';
import type { AuthenticatedRequest } from '../session/session.guard.js';
import { RateLimit } from '../rate-limit/rate-limit.decorator.js';
import { RequiresStepUp, StepUpGuard } from '../session/step-up.guard.js';

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

  private requireClosureApproval(req: AuthenticatedRequest) {
    if (
      !hasStaffPermission(req, 'admin:users:edit') ||
      (!hasStaffPermission(req, 'tickets:write') && !hasStaffPermission(req, 'tickets:*'))
    )
      throw new HttpException(
        'Profile closure approval requires privacy and ticket permissions',
        403
      );
  }

  @Get(':id/closure-preview')
  @ApiOperation({ summary: 'Dry-run an owned profile closure request' })
  async closurePreview(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Req() req: AuthenticatedRequest
  ) {
    this.requireClosureApproval(req);
    return this.ticketsService.staffClosurePreview(req.session, id);
  }

  @Post(':id/execute-closure')
  @HttpCode(200)
  @UseGuards(StepUpGuard)
  @RequiresStepUp()
  @RateLimit({ namespace: 'staff:tickets:closure', limit: 10, windowMs: 60_000 })
  @ApiOperation({ summary: 'Execute a reviewed profile closure atomically' })
  @ApiBody({
    schema: {
      type: 'object',
      required: ['previewVersion', 'confirmation'],
      additionalProperties: false,
      properties: {
        previewVersion: { type: 'string', pattern: '^[a-f0-9]{64}$' },
        confirmation: { type: 'string', enum: ['CLOSE_PROFILE'] },
      },
    },
  })
  @ApiResponse({ status: 200, description: 'Closure completed or idempotently replayed' })
  @ApiResponse({ status: 409, description: 'Preview changed or blockers remain' })
  async executeClosure(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() input: unknown,
    @Req() req: AuthenticatedRequest
  ) {
    this.requireClosureApproval(req);
    const parsed = z
      .object({
        previewVersion: z.string().regex(/^[a-f0-9]{64}$/),
        confirmation: z.literal('CLOSE_PROFILE'),
      })
      .strict()
      .safeParse(input);
    if (!parsed.success) throw new HttpException('Invalid closure confirmation', 400);
    return this.ticketsService.staffExecuteClosure(req.session, id, parsed.data.previewVersion);
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
    return this.ticketsService.readAs(req.session, 'read', async (client, access) => ({
      ...(await this.ticketsService.staffListTickets(
        { ...options, ...(access.scope ? { assignedTo: access.scope } : {}) },
        client
      )),
      responseTargetHours: await this.ticketsService.responseTargetHours(client),
      viewer: {
        userId: req.session.userId,
        canWrite: access.canWrite,
        canAssignOthers: access.canAssignOthers,
        canApproveClosure:
          hasStaffPermission(req, 'admin:users:edit') &&
          (hasStaffPermission(req, 'tickets:write') || hasStaffPermission(req, 'tickets:*')),
      },
    }));
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
    return this.ticketsService.readAs(req.session, 'write', (client, access) => {
      if (!access.canAssignOthers)
        throw new HttpException('Only full ticket managers can choose teams', 403);
      return this.ticketsService.assignmentTeams(client);
    });
  }

  @Get('assignees')
  async assignees(@Req() req: AuthenticatedRequest) {
    if (this.assignedScope(req, 'write') !== undefined)
      throw new HttpException('Only full ticket managers can choose other assignees', 403);
    return this.ticketsService.readAs(req.session, 'write', (client, access) => {
      if (!access.canAssignOthers)
        throw new HttpException('Only full ticket managers can choose other assignees', 403);
      return this.ticketsService.eligibleAssignees(client);
    });
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
    return this.ticketsService.readAs(req.session, 'read', (client, access) =>
      this.ticketsService.staffGetTicket(id, access.scope, client)
    );
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
  @ApiBody({
    schema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        assigneeId: { type: 'string', minLength: 1, maxLength: 512 },
        teamId: { type: 'string', format: 'uuid' },
        idempotencyKey: { type: 'string', format: 'uuid' },
      },
    },
  })
  @ApiResponse({ status: 200, description: 'Ticket assigned.' })
  @ApiResponse({ status: 403, description: 'Not staff' })
  @ApiResponse({ status: 404, description: 'Ticket not found' })
  async assignTicket(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: { assigneeId?: string; teamId?: string; idempotencyKey?: string },
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
        idempotencyKey: z.uuid().optional(),
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
      req.session,
      parsed.data.idempotencyKey
    );
  }

  /**
   * PATCH /api/staff/tickets/:id/status
   *
   * Staff update the status of any ticket.
   */
  @Patch(':id/status')
  @ApiOperation({ summary: 'Staff update ticket status' })
  @ApiBody({
    schema: {
      type: 'object',
      additionalProperties: false,
      required: ['status'],
      properties: {
        status: {
          type: 'string',
          enum: ['open', 'in_progress', 'waiting_customer', 'waiting_staff', 'resolved', 'closed'],
        },
        idempotencyKey: { type: 'string', format: 'uuid' },
        reason: {
          type: 'string',
          minLength: 1,
          maxLength: 2000,
          description:
            'Staff reason stored with the status-change audit; optional for existing clients.',
        },
      },
    },
  })
  @ApiResponse({ status: 200, description: 'Status updated.' })
  @ApiResponse({ status: 400, description: 'Invalid status' })
  @ApiResponse({ status: 403, description: 'Not staff' })
  @ApiResponse({ status: 404, description: 'Ticket not found' })
  async updateTicketStatus(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: unknown,
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
    const data = await parseTicketFormInput(
      z
        .object({
          status: z.enum([
            'open',
            'in_progress',
            'waiting_customer',
            'waiting_staff',
            'resolved',
            'closed',
          ]),
          reason: z.string().trim().min(1).max(2000).optional(),
          idempotencyKey: z.uuid().optional(),
        })
        .strict(),
      body,
      ['reason'],
      () => this.ticketsService.assertTicketFormAuthority(req.session, id, true),
      'Invalid status change'
    );
    return this.ticketsService.staffUpdateTicketStatus(
      id,
      data.status,
      req.session.userId,
      this.assignedScope(req, 'write'),
      req.session,
      data.reason,
      data.idempotencyKey
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
    return this.ticketsService.readAs(req.session, 'read', (client, access) =>
      this.ticketsService.staffListComments(id, access.scope, client)
    );
  }

  @Get(':id/comments/:commentId/attachments/:fileIndex/preview')
  @Header('Cache-Control', 'private, no-store')
  @Header('Vary', 'Cookie')
  @RateLimit({ namespace: 'staff-tickets:attachment-preview:user', limit: 60, windowMs: 60_000 })
  @ApiOperation({ summary: 'Preview a verified attachment within current staff ticket scope' })
  @ApiResponse({
    status: 200,
    content: { 'image/png': { schema: { type: 'string', format: 'binary' } } },
  })
  async attachmentPreview(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Param('commentId', new ParseUUIDPipe()) commentId: string,
    @Param('fileIndex', new ParseIntPipe()) fileIndex: number,
    @Req() req: AuthenticatedRequest
  ) {
    const bytes = await this.ticketsService.readAs(req.session, 'read', (client, access) =>
      this.ticketsService.ticketAttachmentPreview(
        id,
        commentId,
        fileIndex,
        req.session.userId,
        true,
        access.scope,
        client
      )
    );
    return new StreamableFile(bytes, {
      type: 'image/png',
      disposition: 'inline',
      length: bytes.length,
    });
  }

  @Get(':id/attachments/:fileIndex/preview')
  @Header('Cache-Control', 'private, no-store')
  @Header('Vary', 'Cookie')
  @RateLimit({ namespace: 'staff-tickets:attachment-preview:user', limit: 60, windowMs: 60_000 })
  @ApiOperation({
    summary: 'Preview an initial verified attachment within current staff ticket scope',
  })
  @ApiResponse({
    status: 200,
    content: { 'image/png': { schema: { type: 'string', format: 'binary' } } },
  })
  async initialAttachmentPreview(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Param('fileIndex', new ParseIntPipe()) fileIndex: number,
    @Req() req: AuthenticatedRequest
  ) {
    const bytes = await this.ticketsService.readAs(req.session, 'read', (client, access) =>
      this.ticketsService.ticketAttachmentPreview(
        id,
        null,
        fileIndex,
        req.session.userId,
        true,
        access.scope,
        client
      )
    );
    return new StreamableFile(bytes, {
      type: 'image/png',
      disposition: 'inline',
      length: bytes.length,
    });
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
  @ApiBody({ schema: ticketReplyApiSchema })
  async addComment(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body()
    raw: unknown,
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
    const body = await parseTicketFormInput(
      TicketReplySchema,
      raw,
      ['body'],
      () => this.ticketsService.assertTicketFormAuthority(req.session, id, true),
      'Invalid ticket reply',
      true
    );
    const visibility = body.visibility ?? 'public';
    return this.ticketsService.staffAddComment(
      id,
      req.session.userId,
      body.body,
      visibility,
      this.assignedScope(req, 'write'),
      req.session,
      body
    );
  }
}
