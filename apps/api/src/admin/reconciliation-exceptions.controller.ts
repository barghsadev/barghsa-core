import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpException,
  Logger,
  Param,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common'
import { ApiBody, ApiOperation, ApiParam, ApiQuery, ApiResponse, ApiTags } from '@nestjs/swagger'
import { z } from 'zod'
import { SessionAuthGuard } from '../session/session.guard.js'
import type { AuthenticatedRequest } from '../session/session.guard.js'
import { ErrorCodes } from '@barghsa/shared/errors'
import {
  ReconciliationExceptionsService,
  type ReconciliationExceptionDto,
} from './reconciliation-exceptions.service.js'
import {
  RECONCILIATION_STATUSES,
  RECONCILIATION_SEVERITIES,
} from '@barghsa/shared/admin'

/** Zod schema for the resolution/close note body (mandatory, bounded). */
export const ResolutionNoteSchema = z.object({
  note: z.string().trim().min(1).max(1000),
})

/** Strict validation for the list view's limit/offset query params. */
const ListQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).optional(),
  offset: z.coerce.number().int().min(0).optional(),
})

/** Swagger enum values for the reconciliation statuses. */
const STATUSES = [...RECONCILIATION_STATUSES] as const

/** Swagger enum values for the reconciliation severities. */
const SEVERITIES = [...RECONCILIATION_SEVERITIES] as const

/**
 * Reconciliation exception review controller (S-09.09, T-09.09.01).
 *
 * Admin/staff surface for the reconciliation exception lifecycle:
 *
 * - `GET  /api/admin/reconciliation/items` — review queue (filters: status,
 *   severity, limit, offset);
 * - `POST /api/admin/reconciliation/items/:id/investigate` — open →
 *   investigating;
 * - `POST /api/admin/reconciliation/items/:id/resolve` — open/investigating →
 *   resolved (note required);
 * - `POST /api/admin/reconciliation/items/:id/close` — open/investigating/
 *   resolved → closed (note required).
 *
 * The list view is gated by the S-09.09 capability `admin:reconciliation:view`;
 * state transitions by `admin:reconciliation:resolve`. Today the session model
 * exposes only `isAdmin` (platform admin); granular staff-role permissions
 * arrive with the role system. Until then both capabilities map to a platform
 * admin session, mirroring the S-09.07 / S-09.08 admin controllers.
 */
@ApiTags('Admin')
@Controller('api/admin/reconciliation/items')
@UseGuards(SessionAuthGuard)
export class ReconciliationExceptionsController {
  private readonly logger = new Logger(ReconciliationExceptionsController.name)

  constructor(
    private readonly reconciliationService: ReconciliationExceptionsService,
  ) {}

  /**
   * Permission gate for viewing the reconciliation review queue.
   *
   * Capability `admin:reconciliation:view` maps to a platform admin session
   * today; centralized here as a single enforcement point.
   */
  private assertViewPermission(req: AuthenticatedRequest): void {
    if (!(req.session.isAdmin ?? false)) {
      this.logger.warn(
        `Non-admin user ${req.session.userId} attempted to view reconciliation exceptions`,
      )
      throw new HttpException(
        {
          statusCode: 403,
          error: ErrorCodes.AUTHZ_FORBIDDEN.code,
          message: 'Admin role required to view reconciliation exceptions',
        },
        403,
      )
    }
  }

  /**
   * Permission gate for reconciliation state transitions.
   *
   * Capability `admin:reconciliation:resolve` maps to a platform admin
   * session today.
   */
  private assertResolvePermission(req: AuthenticatedRequest): void {
    if (!(req.session.isAdmin ?? false)) {
      this.logger.warn(
        `Non-admin user ${req.session.userId} attempted to resolve a reconciliation exception`,
      )
      throw new HttpException(
        {
          statusCode: 403,
          error: ErrorCodes.AUTHZ_FORBIDDEN.code,
          message: 'Admin role required to resolve reconciliation exceptions',
        },
        403,
      )
    }
  }

  /**
   * GET /api/admin/reconciliation/items?status=open&severity=high&limit=50&offset=0
   *
   * Review queue view for reconciliation exceptions, newest first.
   */
  @Get()
  @ApiOperation({ summary: 'List reconciliation exceptions (review queue)' })
  @ApiQuery({ name: 'status', required: false, enum: STATUSES })
  @ApiQuery({ name: 'severity', required: false, enum: SEVERITIES })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  @ApiQuery({ name: 'offset', required: false, type: Number })
  @ApiResponse({ status: 200, description: 'List of reconciliation exceptions', type: [Object] })
  @ApiResponse({ status: 401, description: 'Not authenticated' })
  @ApiResponse({ status: 403, description: 'Admin role required' })
  async listReconciliationItems(
    @Query('status') status: string | undefined,
    @Query('severity') severity: string | undefined,
    @Query('limit') limit: string | undefined,
    @Query('offset') offset: string | undefined,
    @Req() req: AuthenticatedRequest,
  ): Promise<ReconciliationExceptionDto[]> {
    this.assertViewPermission(req)
    const options: Parameters<ReconciliationExceptionsService['listReconciliationExceptions']>[0] = {}
    if (status !== undefined) {
      options.status = status as NonNullable<typeof options.status>
    }
    if (severity !== undefined) {
      options.severity = severity as NonNullable<typeof options.severity>
    }
    if (limit !== undefined || offset !== undefined) {
      const parsed = ListQuerySchema.safeParse({ limit, offset })
      if (!parsed.success) {
        throw new HttpException(
          {
            statusCode: 400,
            error: ErrorCodes.VALIDATION_INPUT_INVALID.code,
            message: 'limit must be an integer 1..200 and offset a non-negative integer',
          },
          400,
        )
      }
      if (parsed.data.limit !== undefined) options.limit = parsed.data.limit
      if (parsed.data.offset !== undefined) options.offset = parsed.data.offset
    }
    return this.reconciliationService.listReconciliationExceptions(options)
  }

  /**
   * POST /api/admin/reconciliation/items/:id/investigate
   *
   * Mark an open exception `investigating`. Repeated investigation or a
   * transition from a non-open state is rejected (409).
   */
  @Post(':id/investigate')
  @HttpCode(200)
  @ApiOperation({ summary: 'Mark a reconciliation exception as investigating' })
  @ApiParam({ name: 'id', description: 'Reconciliation exception ID' })
  @ApiResponse({ status: 200, description: 'Exception marked investigating', type: Object })
  @ApiResponse({ status: 401, description: 'Not authenticated' })
  @ApiResponse({ status: 403, description: 'Admin role required' })
  @ApiResponse({ status: 404, description: 'Exception not found' })
  @ApiResponse({ status: 409, description: 'State transition not allowed' })
  async investigateItem(
    @Param('id') id: string,
    @Req() req: AuthenticatedRequest,
  ): Promise<ReconciliationExceptionDto> {
    this.assertResolvePermission(req)
    const ip = req.ip ?? req.socket?.remoteAddress ?? 'unknown'
    return this.reconciliationService.investigateReconciliationException(id, req.session.userId, ip)
  }

  /**
   * POST /api/admin/reconciliation/items/:id/resolve
   *
   * Resolve an open/investigating exception with a mandatory explainer.
   */
  @Post(':id/resolve')
  @HttpCode(200)
  @ApiOperation({ summary: 'Resolve a reconciliation exception (note required)' })
  @ApiParam({ name: 'id', description: 'Reconciliation exception ID' })
  @ApiBody({
    schema: {
      type: 'object',
      required: ['note'],
      properties: { note: { type: 'string', description: 'Explanation for the resolution' } },
    },
  })
  @ApiResponse({ status: 200, description: 'Exception resolved', type: Object })
  @ApiResponse({ status: 400, description: 'Missing note or invalid payload' })
  @ApiResponse({ status: 401, description: 'Not authenticated' })
  @ApiResponse({ status: 403, description: 'Admin role required' })
  @ApiResponse({ status: 404, description: 'Exception not found' })
  @ApiResponse({ status: 409, description: 'State transition not allowed' })
  async resolveItem(
    @Param('id') id: string,
    @Body() rawBody: unknown,
    @Req() req: AuthenticatedRequest,
  ): Promise<ReconciliationExceptionDto> {
    this.assertResolvePermission(req)
    const parsed = ResolutionNoteSchema.safeParse(rawBody)
    if (!parsed.success) {
      throw new HttpException(
        {
          statusCode: 400,
          error: ErrorCodes.VALIDATION_INPUT_INVALID.code,
          message: 'note is required when resolving a reconciliation exception',
        },
        400,
      )
    }
    const ip = req.ip ?? req.socket?.remoteAddress ?? 'unknown'
    return this.reconciliationService.resolveReconciliationException(
      id,
      req.session.userId,
      ip,
      parsed.data.note,
    )
  }

  /**
   * POST /api/admin/reconciliation/items/:id/close
   *
   * Close an open/investigating/resolved exception with a mandatory
   * explainer. A closed item is terminal.
   */
  @Post(':id/close')
  @HttpCode(200)
  @ApiOperation({ summary: 'Close a reconciliation exception (note required)' })
  @ApiParam({ name: 'id', description: 'Reconciliation exception ID' })
  @ApiBody({
    schema: {
      type: 'object',
      required: ['note'],
      properties: { note: { type: 'string', description: 'Explanation for the closure' } },
    },
  })
  @ApiResponse({ status: 200, description: 'Exception closed', type: Object })
  @ApiResponse({ status: 400, description: 'Missing note or invalid payload' })
  @ApiResponse({ status: 401, description: 'Not authenticated' })
  @ApiResponse({ status: 403, description: 'Admin role required' })
  @ApiResponse({ status: 404, description: 'Exception not found' })
  @ApiResponse({ status: 409, description: 'State transition not allowed' })
  async closeItem(
    @Param('id') id: string,
    @Body() rawBody: unknown,
    @Req() req: AuthenticatedRequest,
  ): Promise<ReconciliationExceptionDto> {
    this.assertResolvePermission(req)
    const parsed = ResolutionNoteSchema.safeParse(rawBody)
    if (!parsed.success) {
      throw new HttpException(
        {
          statusCode: 400,
          error: ErrorCodes.VALIDATION_INPUT_INVALID.code,
          message: 'note is required when closing a reconciliation exception',
        },
        400,
      )
    }
    const ip = req.ip ?? req.socket?.remoteAddress ?? 'unknown'
    return this.reconciliationService.closeReconciliationException(id, req.session.userId, ip, parsed.data.note)
  }
}