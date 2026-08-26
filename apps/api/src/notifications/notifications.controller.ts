import {
  Controller,
  Get,
  Patch,
  Param,
  Post,
  HttpCode,
  HttpException,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common'
import { ApiBearerAuth, ApiOperation, ApiQuery, ApiResponse, ApiTags } from '@nestjs/swagger'
import { ErrorCodes } from '@barghsa/shared/errors'
import { NotificationsService } from './notifications.service.js'
import { SessionAuthGuard } from '../session/session.guard.js'
import type { AuthenticatedRequest } from '../session/session.guard.js'

@ApiTags('Notifications')
@ApiBearerAuth()
@UseGuards(SessionAuthGuard)
@Controller('api/notifications')
export class NotificationsController {
  constructor(private readonly notificationsService: NotificationsService) {}

  /**
   * GET /api/notifications
   *
   * Get in-app notifications for the authenticated user.
   * Most recent notifications first.
   */
  @Get()
  @ApiOperation({ summary: 'Get in-app notifications for current user' })
  @ApiQuery({ name: 'limit', required: false, type: Number, description: 'Max results (default 50)' })
  @ApiQuery({ name: 'offset', required: false, type: Number, description: 'Pagination offset (default 0)' })
  @ApiResponse({ status: 200, description: 'List of notifications with total and unread count.' })
  async findByUser(
    @Req() req: AuthenticatedRequest,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ) {
    return this.notificationsService.findByUser(
      req.session.userId,
      limit ? parseInt(limit, 10) : 50,
      offset ? parseInt(offset, 10) : 0,
    )
  }

  /**
   * GET /api/notifications/unread-count
   *
   * Get the count of unread notifications for the authenticated user.
   */
  @Get('unread-count')
  @ApiOperation({ summary: 'Get unread notification count' })
  @ApiResponse({ status: 200, description: 'Unread notification count.' })
  async countUnread(@Req() req: AuthenticatedRequest) {
    const count = await this.notificationsService.countUnread(req.session.userId)
    return { unreadCount: count }
  }

  /**
   * PATCH /api/notifications/:id/read
   *
   * Mark a single notification as read.
   */
  @Patch(':id/read')
  @HttpCode(200)
  @ApiOperation({ summary: 'Mark a notification as read' })
  @ApiResponse({ status: 200, description: 'Notification marked as read.' })
  @ApiResponse({ status: 404, description: 'Notification not found' })
  async markAsRead(
    @Param('id') id: string,
    @Req() req: AuthenticatedRequest,
  ) {
    await this.notificationsService.markAsRead(id, req.session.userId)
    return { message: 'Notification marked as read' }
  }

  /**
   * POST /api/notifications/read-all
   *
   * Mark all notifications as read for the authenticated user.
   */
  @Post('read-all')
  @HttpCode(200)
  @ApiOperation({ summary: 'Mark all notifications as read' })
  @ApiResponse({ status: 200, description: 'All notifications marked as read.' })
  async markAllAsRead(@Req() req: AuthenticatedRequest) {
    await this.notificationsService.markAllAsRead(req.session.userId)
    return { message: 'All notifications marked as read' }
  }
}
