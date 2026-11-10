import { privateLogId } from '@barghsa/shared/log-privacy';
import { hasStaffPermission } from '../session/staff-permissions.js';
import {
  Controller,
  Body,
  Get,
  HttpCode,
  HttpException,
  Logger,
  Param,
  Post,
  Query,
  Req,
  UseGuards,
  ParseUUIDPipe,
} from '@nestjs/common';
import { ApiBody, ApiOperation, ApiParam, ApiQuery, ApiResponse, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { offsetPaginationQuerySchema } from '@barghsa/shared/pagination';
import { SessionAuthGuard } from '../session/session.guard.js';
import { StepUpGuard, RequiresStepUp } from '../session/step-up.guard.js';
import type { AuthenticatedRequest } from '../session/session.guard.js';
import { ErrorCodes } from '@barghsa/shared/errors';
import {
  FailedNotificationsService,
  DEAD_LETTER_STATUSES,
  DEAD_LETTER_SEVERITIES,
  NOTIFICATION_CHANNELS,
  MAX_REPLAY_SELECTION,
  type FailedNotificationDto,
} from './failed-notifications.service.js';

/** Strict validation for the list view's limit/offset query params. */
const ListQuerySchema = offsetPaginationQuerySchema(200);

const replayDate = z.iso
  .datetime()
  .refine((value) => !/\.\d{4}/.test(value))
  .transform((value) => new Date(value));
const replayDates = { from: replayDate, to: replayDate };
function validReplayRange({ from, to }: { from: Date; to: Date }): boolean {
  const duration = to.getTime() - from.getTime();
  return duration > 0 && duration <= 31 * 24 * 60 * 60 * 1000;
}
const ReplayPreviewSchema = z.strictObject(replayDates).refine(validReplayRange);
const ReplayBodySchema = z
  .strictObject({
    ...replayDates,
    confirm: z.literal(true),
    selection: z
      .array(
        z.strictObject({
          id: z.uuid().transform((value) => value.toLowerCase()),
          revision: z.string().regex(/^\d{1,13}\.\d{6}$/),
        })
      )
      .min(1)
      .max(MAX_REPLAY_SELECTION),
  })
  .refine(validReplayRange)
  .refine(({ selection }) => new Set(selection.map(({ id }) => id)).size === selection.length);

/** Swagger enum values for the dead-letter statuses. */
const STATUSES = [...DEAD_LETTER_STATUSES] as const;
/** Swagger enum values for the severity classes. */
const SEVERITIES = [...DEAD_LETTER_SEVERITIES] as const;
/** Swagger enum values for notification channels. */
const CHANNELS = [...NOTIFICATION_CHANNELS] as const;

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
 * by `admin:jobs:view`, state transitions by `admin:jobs:retry`.
 */
@ApiTags('Admin')
@Controller(['api/admin/failed-notifications', 'api/admin/notifications/dead-letters'])
@UseGuards(SessionAuthGuard)
export class FailedNotificationsController {
  private readonly logger = new Logger(FailedNotificationsController.name);

  constructor(private readonly failedNotificationsService: FailedNotificationsService) {}

  @Get('access')
  access(@Req() req: AuthenticatedRequest) {
    return {
      canView: hasStaffPermission(req, 'admin:jobs:view'),
      canRetry: hasStaffPermission(req, 'admin:jobs:retry'),
    };
  }

  private assertViewPermission(req: AuthenticatedRequest): void {
    if (!hasStaffPermission(req, 'admin:jobs:view')) {
      this.logger.warn(
        `Non-admin user ${privateLogId('actor', req.session.userId)} attempted to view dead-letter notifications`
      );
      throw new HttpException(
        {
          statusCode: 403,
          error: ErrorCodes.AUTHZ_FORBIDDEN.code,
          message: 'Admin role required to view dead-letter notifications',
        },
        403
      );
    }
  }

  private assertRetryPermission(req: AuthenticatedRequest): void {
    if (!hasStaffPermission(req, 'admin:jobs:retry')) {
      this.logger.warn(
        `Non-admin user ${privateLogId('actor', req.session.userId)} attempted to mutate a dead-letter notification`
      );
      throw new HttpException(
        {
          statusCode: 403,
          error: ErrorCodes.AUTHZ_FORBIDDEN.code,
          message: 'Admin role required to retry, resolve, or dismiss dead-letter notifications',
        },
        403
      );
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
    @Req() req: AuthenticatedRequest
  ): Promise<FailedNotificationDto[]> {
    this.assertViewPermission(req);
    const options: Parameters<FailedNotificationsService['listFailedNotifications']>[0] = {};
    if (status !== undefined) options.status = status as NonNullable<typeof options.status>;
    if (severity !== undefined) options.severity = severity as NonNullable<typeof options.severity>;
    if (channel !== undefined) options.channel = channel;
    if (limit !== undefined || offset !== undefined) {
      const parsed = ListQuerySchema.safeParse({ limit, offset });
      if (!parsed.success) {
        throw new HttpException(
          {
            statusCode: 400,
            error: ErrorCodes.VALIDATION_INPUT_INVALID.code,
            message: 'limit must be an integer 1..200 and offset a non-negative integer',
          },
          400
        );
      }
      if (parsed.data.limit !== undefined) options.limit = parsed.data.limit;
      if (parsed.data.offset !== undefined) options.offset = parsed.data.offset;
    }
    return this.failedNotificationsService.listFailedNotifications(options);
  }

  @Get('replay-preview')
  @ApiOperation({ summary: 'Preview eligible notification retries for a UTC outbox date range' })
  @ApiQuery({ name: 'from', type: String, description: 'Inclusive UTC outbox creation time' })
  @ApiQuery({ name: 'to', type: String, description: 'Exclusive UTC outbox creation time' })
  async previewReplay(@Query() query: unknown, @Req() req: AuthenticatedRequest) {
    this.assertViewPermission(req);
    this.assertRetryPermission(req);
    const parsed = ReplayPreviewSchema.safeParse(query);
    if (!parsed.success)
      throw new HttpException({ error: ErrorCodes.VALIDATION_INPUT_INVALID.code }, 400);
    return this.failedNotificationsService.previewOutboxReplay(parsed.data, req.session);
  }

  @Post('replay')
  @UseGuards(StepUpGuard)
  @RequiresStepUp()
  @HttpCode(200)
  @ApiOperation({ summary: 'Requeue the exact confirmed notification retry selection' })
  @ApiBody({
    schema: {
      type: 'object',
      required: ['from', 'to', 'confirm', 'selection'],
      properties: {
        from: { type: 'string', format: 'date-time' },
        to: { type: 'string', format: 'date-time' },
        confirm: { type: 'boolean', enum: [true] },
        selection: {
          type: 'array',
          minItems: 1,
          maxItems: MAX_REPLAY_SELECTION,
          items: {
            type: 'object',
            required: ['id', 'revision'],
            properties: {
              id: { type: 'string', format: 'uuid' },
              revision: { type: 'string', description: 'Exact value from the preview' },
            },
          },
        },
      },
    },
  })
  async replay(@Body() body: unknown, @Req() req: AuthenticatedRequest) {
    this.assertViewPermission(req);
    this.assertRetryPermission(req);
    const parsed = ReplayBodySchema.safeParse(body);
    if (!parsed.success)
      throw new HttpException({ error: ErrorCodes.VALIDATION_INPUT_INVALID.code }, 400);
    const { from, to, selection } = parsed.data;
    const ip = req.ip ?? req.socket?.remoteAddress ?? 'unknown';
    return this.failedNotificationsService.replayOutbox({ from, to }, selection, req.session, ip);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Read a selected masked notification independently of queue filters' })
  @ApiParam({ name: 'id', description: 'Dead-letter notification ID' })
  @ApiResponse({ status: 200, description: 'Current masked notification', type: Object })
  @ApiResponse({ status: 403, description: 'View permission required' })
  @ApiResponse({ status: 404, description: 'Notification not found' })
  detail(@Param('id', new ParseUUIDPipe()) id: string, @Req() req: AuthenticatedRequest) {
    this.assertViewPermission(req);
    return this.failedNotificationsService.getFailedNotification(id);
  }

  /**
   * POST /api/admin/failed-notifications/:id/retry
   *
   * Re-queue a dead-lettered notification for a fresh delivery attempt.
   */
  @Post(':id/retry')
  @UseGuards(StepUpGuard)
  @RequiresStepUp()
  @HttpCode(200)
  @ApiOperation({ summary: 'Retry a dead-letter notification (admin)' })
  @ApiParam({ name: 'id', description: 'Dead-letter notification ID' })
  @ApiResponse({ status: 200, description: 'Notification marked retried', type: Object })
  @ApiResponse({ status: 401, description: 'Not authenticated' })
  @ApiResponse({ status: 403, description: 'Admin role required' })
  @ApiResponse({ status: 404, description: 'Not found' })
  @ApiResponse({ status: 409, description: 'State transition not allowed' })
  async retry(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Req() req: AuthenticatedRequest
  ): Promise<FailedNotificationDto> {
    this.assertRetryPermission(req);
    const ip = req.ip ?? req.socket?.remoteAddress ?? 'unknown';
    return this.failedNotificationsService.retryFailedNotification(id, req.session, ip);
  }

  /**
   * POST /api/admin/failed-notifications/:id/resolve
   *
   * Mark a dead-lettered notification durably resolved (terminal).
   */
  @Post(':id/resolve')
  @UseGuards(StepUpGuard)
  @RequiresStepUp()
  @HttpCode(200)
  @ApiOperation({ summary: 'Resolve a dead-letter notification (admin)' })
  @ApiParam({ name: 'id', description: 'Dead-letter notification ID' })
  @ApiResponse({ status: 200, description: 'Notification resolved', type: Object })
  @ApiResponse({ status: 401, description: 'Not authenticated' })
  @ApiResponse({ status: 403, description: 'Admin role required' })
  @ApiResponse({ status: 404, description: 'Not found' })
  @ApiResponse({ status: 409, description: 'State transition not allowed' })
  async resolve(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Req() req: AuthenticatedRequest
  ): Promise<FailedNotificationDto> {
    this.assertRetryPermission(req);
    const ip = req.ip ?? req.socket?.remoteAddress ?? 'unknown';
    return this.failedNotificationsService.resolveFailedNotification(id, req.session, ip);
  }

  /**
   * POST /api/admin/failed-notifications/:id/dismiss
   *
   * Acknowledge a dead-lettered notification and remove it from the active view.
   */
  @Post(':id/dismiss')
  @UseGuards(StepUpGuard)
  @RequiresStepUp()
  @HttpCode(200)
  @ApiOperation({ summary: 'Dismiss a dead-letter notification (admin)' })
  @ApiParam({ name: 'id', description: 'Dead-letter notification ID' })
  @ApiResponse({ status: 200, description: 'Notification dismissed', type: Object })
  @ApiResponse({ status: 401, description: 'Not authenticated' })
  @ApiResponse({ status: 403, description: 'Admin role required' })
  @ApiResponse({ status: 404, description: 'Not found' })
  @ApiResponse({ status: 409, description: 'State transition not allowed' })
  async dismiss(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Req() req: AuthenticatedRequest
  ): Promise<FailedNotificationDto> {
    this.assertRetryPermission(req);
    const ip = req.ip ?? req.socket?.remoteAddress ?? 'unknown';
    return this.failedNotificationsService.dismissFailedNotification(id, req.session, ip);
  }
}
