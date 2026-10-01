import { ticketReply, ticketReplyApiSchema, ticketListQuery } from './ticket-input.js';
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
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Response } from 'express';
import { ApiBody, ApiOperation, ApiResponse, ApiQuery, ApiTags } from '@nestjs/swagger';
import { TicketsService } from './tickets.service.js';
import { SessionAuthGuard } from '../session/session.guard.js';
import type { AuthenticatedRequest } from '../session/session.guard.js';
import { RateLimit } from '../rate-limit/rate-limit.decorator.js';
import { activeProfileSql } from '../profiles/profile-context.js';
import { ErrorCodes } from '@barghsa/shared/errors';
import { z } from 'zod';

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
  @ApiBody({
    schema: {
      type: 'object',
      required: ['subject', 'body'],
      additionalProperties: false,
      properties: {
        subject: { type: 'string', minLength: 1, maxLength: 200 },
        body: { type: 'string', minLength: 1, maxLength: 10000 },
        category: {
          type: 'string',
          enum: ['general', 'billing', 'orders', 'privacy'],
          default: 'general',
        },
        priority: { type: 'string', enum: ['normal', 'high'], default: 'normal' },
        profileId: { type: 'string', format: 'uuid', nullable: true },
        relatedEntityType: {
          type: 'string',
          enum: ['order', 'contract', 'invoice'],
          nullable: true,
        },
        relatedEntityId: { type: 'string', minLength: 1, maxLength: 512, nullable: true },
        attachments: {
          type: 'array',
          maxItems: 5,
          nullable: true,
          items: { type: 'string', minLength: 1, maxLength: 512 },
        },
      },
    },
  })
  @ApiResponse({ status: 201, description: 'Ticket created.' })
  @ApiResponse({ status: 400, description: 'Validation error' })
  @ApiResponse({ status: 401, description: 'Not authenticated' })
  @ApiResponse({ status: 404, description: 'Profile not found' })
  async createTicket(
    @Body()
    body: {
      subject: string;
      body: string;
      category?: 'general' | 'billing' | 'orders' | 'privacy';
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
  @ApiQuery({
    name: 'status',
    required: false,
    description: 'Filter by status; active includes all non-terminal statuses',
  })
  @ApiQuery({
    name: 'scope',
    required: false,
    description: 'Set to active to limit to the accessible active profile',
  })
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
    @Query('scope') scope?: string,
    @Req() req?: AuthenticatedRequest
  ) {
    const { scope: validatedScope, ...options } = ticketListQuery({
      page,
      limit,
      status,
      search,
      sortBy,
      sortOrder,
      scope,
    });
    return this.ticketsService.readAs(req!.session, false, async (client) => {
      const profileId =
        validatedScope === 'active'
          ? (
              await client.query<{ id: string }>(activeProfileSql('profile:view'), [
                req!.session.userId,
              ])
            ).rows[0]?.id
          : undefined;
      if (validatedScope === 'active' && !profileId)
        throw new HttpException(
          { error: ErrorCodes.NOT_FOUND_RESOURCE.code, message: 'No accessible active profile' },
          404
        );
      return this.ticketsService.listTickets(
        req!.session.userId,
        { ...options, ...(profileId ? { profileId } : {}) },
        client
      );
    });
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
    return this.ticketsService.readAs(req.session, false, (client) =>
      this.ticketsService.creationOptions(
        req.session.userId,
        profileId,
        recordPage === undefined ? 1 : Number(recordPage),
        client
      )
    );
  }

  @Get('lifecycle-preview')
  @RateLimit({ namespace: 'tickets:lifecycle:preview', limit: 30, windowMs: 60_000 })
  @ApiOperation({ summary: 'Preview closure blockers for the active owned profile' })
  @ApiResponse({
    status: 200,
    description: 'Live blockers and recent requests for the active owned profile',
  })
  @ApiResponse({ status: 403, description: 'No active owned profile' })
  lifecyclePreview(@Req() req: AuthenticatedRequest) {
    return this.ticketsService.lifecyclePreview(req.session);
  }

  @Post('lifecycle-requests')
  @HttpCode(201)
  @RateLimit({ namespace: 'tickets:lifecycle:create', limit: 10, windowMs: 60_000 })
  @ApiOperation({ summary: 'Request a profile data export or closure through support' })
  @ApiBody({
    schema: {
      type: 'object',
      required: ['type', 'idempotencyKey'],
      additionalProperties: false,
      properties: {
        type: { type: 'string', enum: ['export', 'closure'] },
        idempotencyKey: { type: 'string', format: 'uuid' },
        locale: { type: 'string', enum: ['fa', 'en'], default: 'fa' },
      },
    },
  })
  @ApiResponse({ status: 201, description: 'Privacy support request created or replayed' })
  @ApiResponse({ status: 403, description: 'No active owned profile' })
  @ApiResponse({ status: 409, description: 'Idempotency key belongs to another request' })
  createLifecycleRequest(@Body() input: unknown, @Req() req: AuthenticatedRequest) {
    const parsed = z
      .object({
        type: z.enum(['export', 'closure']),
        idempotencyKey: z.uuid(),
        locale: z.enum(['fa', 'en']).default('fa'),
      })
      .strict()
      .safeParse(input);
    if (!parsed.success) throw new HttpException('Invalid lifecycle request', 400);
    return this.ticketsService.createLifecycleRequest(
      req.session,
      parsed.data.type,
      parsed.data.idempotencyKey,
      parsed.data.locale
    );
  }

  @Post('lifecycle-requests/:id/export')
  @HttpCode(202)
  @RateLimit({ namespace: 'tickets:lifecycle:export', limit: 10, windowMs: 60_000 })
  @ApiOperation({ summary: 'Queue an export for an owned privacy request' })
  @ApiResponse({ status: 202, description: 'Owner-scoped export job created or reused' })
  startProfileExport(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Req() req: AuthenticatedRequest
  ) {
    return this.ticketsService.startProfileExport(req.session, id);
  }

  @Get('lifecycle-requests/:id/export')
  @RateLimit({ namespace: 'tickets:lifecycle:download', limit: 20, windowMs: 60_000 })
  @ApiOperation({ summary: 'Download a completed, unexpired profile export' })
  @ApiResponse({ status: 302, description: 'Short-lived private download URL' })
  async downloadProfileExport(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Req() req: AuthenticatedRequest,
    @Res() res: Response
  ): Promise<void> {
    const url = await this.ticketsService.downloadProfileExport(req.session, id);
    res.setHeader('Cache-Control', 'private, no-store');
    res.redirect(302, url);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get ticket detail' })
  @ApiResponse({ status: 200, description: 'Ticket detail.' })
  @ApiResponse({ status: 401, description: 'Not authenticated' })
  @ApiResponse({ status: 404, description: 'Ticket not found' })
  async getTicket(@Param('id', new ParseUUIDPipe()) id: string, @Req() req: AuthenticatedRequest) {
    return this.ticketsService.readAs(req.session, false, (client) =>
      this.ticketsService.getTicket(id, req.session.userId, client)
    );
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
    return this.ticketsService.readAs(req.session, false, (client) =>
      this.ticketsService.listComments(id, req.session.userId, false, client)
    );
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
  @ApiBody({ schema: ticketReplyApiSchema })
  async addComment(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body()
    raw: unknown,
    @Req() req: AuthenticatedRequest
  ) {
    // Internal notes belong only to the staff endpoint.
    const body = ticketReply(raw);
    const visibility = body.visibility ?? 'public';
    if (visibility === 'internal') {
      throw new HttpException(
        { statusCode: 403, error: 'FORBIDDEN', message: 'Only staff can add internal notes' },
        403
      );
    }
    return this.ticketsService.addComment(
      id,
      req.session.userId,
      body.body,
      visibility,
      false,
      req.session,
      body
    );
  }
}
