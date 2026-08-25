import {
  Body,
  Controller,
  Get,
  Put,
  HttpCode,
  HttpException,
  Logger,
  Req,
  UseGuards,
} from '@nestjs/common'
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger'
import { getDbPool } from '@barghsa/db'
import { ErrorCodes } from '@barghsa/shared/errors'
import { SessionAuthGuard } from '../session/session.guard.js'
import type { AuthenticatedRequest } from '../session/session.guard.js'
import { RateLimit } from '../rate-limit/rate-limit.decorator.js'

/**
 * Allowed notification channel values.
 */
const VALID_CHANNELS = ['SMS', 'EMAIL', 'IN_APP'] as const
type NotificationChannel = (typeof VALID_CHANNELS)[number]

@ApiTags('User Settings')
@Controller('api/user/settings')
@UseGuards(SessionAuthGuard)
export class UserSettingsController {
  private readonly logger = new Logger(UserSettingsController.name)

  /**
   * GET /api/user/settings/notifications
   *
   * Returns the current user's notification channel preferences.
   */
  @Get('notifications')
  @HttpCode(200)
  @RateLimit({ namespace: 'settings:notifications:get', limit: 60, windowMs: 60_000 })
  @ApiOperation({ summary: 'Get notification channel preferences' })
  @ApiResponse({
    status: 200,
    description: 'Current notification preferences.',
    schema: {
      type: 'object',
      properties: {
        channels: { type: 'array', items: { type: 'string', enum: ['SMS', 'EMAIL', 'IN_APP'] } },
      },
    },
  })
  @ApiResponse({ status: 401, description: 'Not authenticated' })
  async getNotificationPreferences(@Req() req: AuthenticatedRequest) {
    const userId = req.session.userId
    const pool = getDbPool()

    const result = await pool.query(
      `SELECT notification_preferences FROM users WHERE user_id = $1`,
      [userId],
    )

    if (result.rows.length === 0) {
      throw new HttpException(
        { statusCode: 404, error: ErrorCodes.NOT_FOUND_RESOURCE.code },
        404,
      )
    }

    const raw = result.rows[0].notification_preferences as string
    const channels = raw.split(',').filter((c) => VALID_CHANNELS.includes(c as NotificationChannel))

    this.logger.debug(`User ${userId}: notification preferences = ${channels.join(',')}`)
    return { channels }
  }

  /**
   * PUT /api/user/settings/notifications
   *
   * Updates the authenticated user's notification channel preferences.
   * At minimum, IN_APP is always included.
   * Only channels that are available to the user are accepted:
   * - EMAIL: only if the user has an email address
   * - SMS: only if the user has a mobile number
   */
  @Put('notifications')
  @HttpCode(200)
  @RateLimit({ namespace: 'settings:notifications:put', limit: 20, windowMs: 60_000 })
  @ApiOperation({ summary: 'Update notification channel preferences' })
  @ApiResponse({
    status: 200,
    description: 'Notification preferences updated.',
    schema: {
      type: 'object',
      properties: {
        channels: { type: 'array', items: { type: 'string', enum: ['SMS', 'EMAIL', 'IN_APP'] } },
      },
    },
  })
  @ApiResponse({ status: 400, description: 'Invalid channels' })
  @ApiResponse({ status: 401, description: 'Not authenticated' })
  async updateNotificationPreferences(
    @Body() body: { channels: string[] },
    @Req() req: AuthenticatedRequest,
  ) {
    const userId = req.session.userId

    if (!Array.isArray(body.channels) || body.channels.length === 0) {
      throw new HttpException(
        { statusCode: 400, error: ErrorCodes.VALIDATION_INPUT_INVALID.code, message: 'Channels must be a non-empty array' },
        400,
      )
    }

    // Validate each channel
    const invalid = body.channels.filter((c) => !VALID_CHANNELS.includes(c as NotificationChannel))
    if (invalid.length > 0) {
      throw new HttpException(
        {
          statusCode: 400,
          error: ErrorCodes.VALIDATION_INPUT_INVALID.code,
          message: `Invalid channels: ${invalid.join(', ')}. Allowed: ${VALID_CHANNELS.join(', ')}`,
        },
        400,
      )
    }

    // IN_APP is always included
    const channels = [...new Set([...body.channels, 'IN_APP'])]

    // Check availability based on what the user has
    const pool = getDbPool()
    const userResult = await pool.query(
      `SELECT email, mobile FROM users WHERE user_id = $1`,
      [userId],
    )

    if (userResult.rows.length === 0) {
      throw new HttpException(
        { statusCode: 404, error: ErrorCodes.NOT_FOUND_RESOURCE.code },
        404,
      )
    }

    const user = userResult.rows[0]
    const hasEmail = !!user.email
    const hasMobile = !!user.mobile

    if (channels.includes('EMAIL') && !hasEmail) {
      throw new HttpException(
        { statusCode: 400, error: ErrorCodes.VALIDATION_INPUT_INVALID.code, message: 'No email address registered. Add an email first.' },
        400,
      )
    }

    if (channels.includes('SMS') && !hasMobile) {
      throw new HttpException(
        { statusCode: 400, error: ErrorCodes.VALIDATION_INPUT_INVALID.code, message: 'No mobile number registered. Add a mobile first.' },
        400,
      )
    }

    // Store as comma-separated string
    const channelStr = channels.join(',')

    await pool.query(
      `UPDATE users SET notification_preferences = $1, updated_at = NOW() WHERE user_id = $2`,
      [channelStr, userId],
    )

    this.logger.log(`User ${userId}: notification preferences updated to ${channelStr}`)

    return { channels }
  }
}