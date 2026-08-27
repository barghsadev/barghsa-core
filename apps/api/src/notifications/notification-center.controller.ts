import {
  Controller,
  Get,
  Patch,
  Param,
  HttpCode,
  NotFoundException,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common'
import {
  ApiBearerAuth,
  ApiOperation,
  ApiQuery,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger'
import { SessionAuthGuard } from '../session/session.guard.js'
import type { AuthenticatedRequest } from '../session/session.guard.js'
import { NotificationCenterService } from './notification-center.service.js'
import type {
  NotificationCenterPage,
  CursorDirection,
  NotificationFilter,
} from './notification-center.service.js'

/**
 * Notification center API (E-05, T-05.02.02).
 *
 * Profile-scoped read + read-state endpoints over `in_app_notifications`.
 * The authenticated user's active (default) profile is resolved server-side;
 * all queries are scoped to it so a caller can only see/mutate their own.
 *
 * Routes:
 *   GET   /api/v1/notifications            -> cursor-keyed page
 *   PATCH /api/v1/notifications/read-all   -> mark all read
 *   PATCH /api/v1/notifications/:id/read   -> mark one read
 *
 * The response envelope `{ data, next_cursor, unread_count }` is the contract
 * consumed by the notification center UI (T-05.02.03).
 */
@ApiTags('Notification Center')
@ApiBearerAuth()
@UseGuards(SessionAuthGuard)
@Controller('api/v1/notifications')
export class NotificationCenterController {
  constructor(private readonly notificationCenterService: NotificationCenterService) {}

  private async requireActiveProfile(req: AuthenticatedRequest): Promise<string> {
    const profileId = await this.notificationCenterService.resolveActiveProfileId(
      req.session.userId,
    )
    if (!profileId) {
      throw new NotFoundException({
        statusCode: 404,
        error: 'NOT_FOUND:RESOURCE',
        message: 'No active profile',
      })
    }
    return profileId
  }

  /**
   * GET /api/v1/notifications?cursor=&limit=&filter=&direction=
   *
   * Returns the newest page of the caller's notifications as
   * `{ data, next_cursor, unread_count }`. `filter=unread` returns only
   * unread rows. `cursor` continues pagination (older by default); pass
   * `direction=newer` to refresh with rows newer than a loaded page.
   */
  @Get()
  @ApiOperation({ summary: 'List notification-center notifications (cursor-keyed)' })
  @ApiQuery({ name: 'cursor', required: false, type: String })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  @ApiQuery({ name: 'filter', required: false, enum: ['all', 'unread'] })
  @ApiQuery({ name: 'direction', required: false, enum: ['older', 'newer'] })
  @ApiResponse({
    status: 200,
    description: '{ data, next_cursor, unread_count }',
  })
  async list(
    @Req() req: AuthenticatedRequest,
    @Query('cursor') cursor?: string,
    @Query('limit') limit?: string,
    @Query('filter') filter?: string,
    @Query('direction') direction?: string,
  ): Promise<NotificationCenterPage> {
    const profileId = await this.requireActiveProfile(req)
    const normFilter: NotificationFilter =
      filter === 'unread' ? 'unread' : 'all'
    const normDirection: CursorDirection =
      direction === 'newer' ? 'newer' : 'older'
    const parsedLimit = limit !== undefined ? parseInt(limit, 10) : undefined

    const options: {
      cursor?: string
      limit?: number
      filter: NotificationFilter
      direction: CursorDirection
    } = {
      filter: normFilter,
      direction: normDirection,
    }
    if (cursor) options.cursor = cursor
    if (parsedLimit !== undefined) options.limit = parsedLimit

    return this.notificationCenterService.list(profileId, options)
  }

  /**
   * PATCH /api/v1/notifications/read-all
   *
   * Marks every unread notification in the caller's active profile as read.
   */
  @Patch('read-all')
  @HttpCode(200)
  @ApiOperation({ summary: 'Mark all notifications read' })
  @ApiResponse({ status: 200, description: '{ marked, unread_count }' })
  async markAllRead(@Req() req: AuthenticatedRequest) {
    const profileId = await this.requireActiveProfile(req)
    const marked = await this.notificationCenterService.markAllRead(profileId)
    return { marked, unread_count: 0 }
  }

  /**
   * PATCH /api/v1/notifications/:id/read
   *
   * Marks a single notification read (404 if it does not belong to the
   * caller's active profile).
   */
  @Patch(':id/read')
  @HttpCode(200)
  @ApiOperation({ summary: 'Mark one notification read' })
  @ApiResponse({ status: 200, description: '{ id, is_read, unread_count }' })
  @ApiResponse({ status: 404, description: 'Notification not found' })
  async markRead(@Param('id') id: string, @Req() req: AuthenticatedRequest) {
    const profileId = await this.requireActiveProfile(req)
    await this.notificationCenterService.markRead(profileId, id)
    const unreadCount = await this.notificationCenterService.countUnread(profileId)
    return { id, is_read: true, unread_count: unreadCount }
  }
}
