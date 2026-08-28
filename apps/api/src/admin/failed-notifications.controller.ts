import {
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
import { ApiOperation, ApiParam, ApiQuery, ApiResponse, ApiTags } from '@nestjs/swagger'
import { z } from 'zod'
import { SessionAuthGuard } from '../session/session.guard.js'
import type { AuthenticatedRequest } from '../session/session.guard.js'
import { ErrorCodes } from '@barghsa/shared/errors'
import {
  FailedNotificationsService,
  DEAD_LETTER_STATUSES,
  DEAD_LETTER_SEVERITIES,
  NOTIFICATION_CHANNELS,
  type FailedNotificationDto,
} from './failed-notifications.service.js'

/** Strict validation for the list view's limit/offset query params. */
const ListQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).optional(),
  offset: z.coerce.number().int().min(0).optional(),
})

/** Swagger enum values for the dead-letter statuses. */
const STATUSES = [...DEAD_LETTER_STATUSES] as const
/** Swagger enum values for the severity classes. */
const SEVERITIES = [...DEAD_LETTER_SEVERITIES] as const
/** Swagger enum values for notification channels. */
const CHANNELS = [...NOTIFICATION_CHANNELS] as const

/**
 * Failed-notifications dashboard controller (S-09.09, T-09.09.03).
 *
 * Admin/staff surface for notification deliveries that dead-lettered:
 *
 * - `GET  /api/admin/failed-notifications` — triage view (filters: status,
 *   severity, channel, limit, offset), raw payload masked;
 * - `POST /api/admin/failed-notifications/:id/retry` — re-queue the
 *   notification for a fresh delivery attempt;
 * - `POST /api/admin/failed-notifications/:id/resolve` — durable terminal
 *   dismissal;
 * - `POST /api/admin/failed-notifications/:id/dismiss` — acknowledge and
 *   remove from the active view.
 *
 * Permissions mirror the failed-jobs surface (T-09.09.02): viewing is gated
 * by `admin:jobs:view`, state transitions by `admin:jobs:retry`, both mapped
 * to a platform-admin session until the granular staff-role system lands.
 */
@ApiTags('Admin')
@Controller('api/admin/failed-notifications')
@UseGuards(SessionAuthGuard)
export class FailedNotificationsController {
  private readonly logger = new Logger(FailedNotificationsController.name)

  constructor(private readonly failedNotificationsService: FailedNotificationsService) {}

  private assertViewPermission(req: AuthenticatedRequest): void {
    if (!(req.session.isAdmin ?? false)) {
      this.logger.warn(
        `Non-admin user ${req.session.userId} attempted to view dead-letter notifications`,
      )
      throw new HttpException(
        {
          statusCode: 403,
          error: ErrorCodes.AUTHZ_FORBIDDEN.code,
          message: 'Admin role required to view dead-letter notifications',
        },
        403,
      )
    }
  }

  private assertRetryPermission(req: AuthenticatedRequest): void {
    if (!(req.session.isAdmin ?? false)) {
      this.logger.warn(
        `Non-admin user ${req.session.userId} attempted to mutate a dead-letter notification`,
      )
      throw new HttpException(
        {
          statusCode: 403,
          error: ErrorCodes.AUTHZ_FORBIDDEN.code,
          message: 'Admin role required to retry, resolve, or dismiss dead-letter notifications',
        },
        403,
      )
    }
  }

  /**
   * GET /api/admin/failed-notifications?status=open&severity=critical&channel=email&limit=50&offset=0
   *
   * Triage view for dead-lettered notifications, newest-first, with raw
   * payload data masked for safe rendering in the ops panel.
   */
  @Get()
  @ApiOperation({ summary: 'List dead-letter notifications (admin)' })
  @ApiQuery({ name: 'status', required: false, enum: STATUSES })
  @ApiQuery({ name: 'severity', required: false, enum: SEVERITIES })
  @ApiQuery({ name: 'channel', required: false, enum: CHANNELS })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  @ApiQuery({ name: 'offset', required: false, type: Number })
  @ApiResponse({ status: 200, description: 'List of dead-letter notifications', type: [Object] })
  @ApiResponse({ status: 401, description: 'Not authenticated' })
  @ApiResponse({ status: 403, description: 'Admin role required' })
  async list(
    @Query('status') status: string | undefined,
    @Query('severity') severity: string | undefined,
    @Query('channel') channel: string | undefined,
    @Query('limit') limit: string | undefined,
    @Query('offset') offset: string | undefined,
    @Req() req: AuthenticatedRequest,
  ): Promise<FailedNotificationDto[]> {
    this.assertViewPermission(req)
    const options: Parameters<FailedNotificationsService['listFailedNotifications']>[0] = {}
    if (status !== undefined) options.status = status as NonNullable<typeof options.status>
    if (severity !== undefined) options.severity = severity as NonNullable<typeof options.severity>
    if (channel !== undefined) options.channel = channel
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
    return this.failedNotificationsService.listFailedNotifications(options)
  }

  /**
   * POST /api/admin/failed-notifications/:id/retry
   *
   * Re-queue a dead-lettered notification for a fresh delivery attempt.
   */
  @Post(':id/retry')
  @HttpCode(200)
  @ApiOperation({ summary: 'Retry a dead-letter notification (admin)' })
  @ApiParam({ name: 'id', description: 'Dead-letter notification ID' })
  @ApiResponse({ status: 200, description: 'Notification marked retried', type: Object })
  @ApiResponse({ status: 401, description: 'Not authenticated' })
  @ApiResponse({ status: 403, description: 'Admin role required' })
  @ApiResponse({ status: 404, description: 'Not found' })
  @ApiResponse({ status: 409, description: 'State transition not allowed' })
  async retry(@Param('id') id: string, @Req() req: AuthenticatedRequest): Promise<FailedNotificationDto> {
    this.assertRetryPermission(req)
    const ip = req.ip ?? req.socket?.remoteAddress ?? 'unknown'
    return this.failedNotificationsService.retryFailedNotification(id, req.session.userId, ip)
  }

  /**
   * POST /api/admin/failed-notifications/:id/resolve
   *
   * Mark a dead-lettered notification durably resolved (terminal).
   */
  @Post(':id/resolve')
  @HttpCode(200)
  @ApiOperation({ summary: 'Resolve a dead-letter notification (admin)' })
  @ApiParam({ name: 'id', description: 'Dead-letter notification ID' })
  @ApiResponse({ status: 200, description: 'Notification resolved', type: Object })
  @ApiResponse({ status: 401, description: 'Not authenticated' })
  @ApiResponse({ status: 403, description: 'Admin role required' })
  @ApiResponse({ status: 404, description: 'Not found' })
  @ApiResponse({ status: 409, description: 'State transition not allowed' })
  async resolve(@Param('id') id: string, @Req() req: AuthenticatedRequest): Promise<FailedNotificationDto> {
    this.assertRetryPermission(req)
    const ip = req.ip ?? req.socket?.remoteAddress ?? 'unknown'
    return this.failedNotificationsService.resolveFailedNotification(id, req.session.userId, ip)
  }

  /**
   * POST /api/admin/failed-notifications/:id/dismiss
   *
   * Acknowledge a dead-lettered notification and remove it from the active view.
   */
  @Post(':id/dismiss')
  @HttpCode(200)
  @ApiOperation({ summary: 'Dismiss a dead-letter notification (admin)' })
  @ApiParam({ name: 'id', description: 'Dead-letter notification ID' })
  @ApiResponse({ status: 200, description: 'Notification dismissed', type: Object })
  @ApiResponse({ status: 401, description: 'Not authenticated' })
  @ApiResponse({ status: 403, description: 'Admin role required' })
  @ApiResponse({ status: 404, description: 'Not found' })
  @ApiResponse({ status: 409, description: 'State transition not allowed' })
  async dismiss(@Param('id') id: string, @Req() req: AuthenticatedRequest): Promise<FailedNotificationDto> {
    this.assertRetryPermission(req)
    const ip = req.ip ?? req.socket?.remoteAddress ?? 'unknown'
    return this.failedNotificationsService.dismissFailedNotification(id, req.session.userId, ip)
  }
}
