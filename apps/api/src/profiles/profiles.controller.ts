import {
  Controller,
  Get,
  Post,
  HttpCode,
  HttpException,
  Logger,
  Param,
  Req,
  UseGuards,
} from '@nestjs/common'
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger'
import { ProfilesService } from './profiles.service.js'
import { SessionAuthGuard } from '../session/session.guard.js'
import type { AuthenticatedRequest } from '../session/session.guard.js'
import { RateLimit } from '../rate-limit/rate-limit.decorator.js'
import { ErrorCodes } from '@barghsa/shared/errors'

@ApiTags('Profiles')
@Controller('api/profiles')
@UseGuards(SessionAuthGuard)
export class ProfilesController {
  private readonly logger = new Logger(ProfilesController.name)

  constructor(private readonly profilesService: ProfilesService) {}

  /**
   * GET /api/profiles
   *
   * Returns all profiles for the authenticated user, along with
   * default/active profile info. Used by the app-level profile
   * check middleware (T-03.01.01) after login to determine whether
   * to redirect to onboarding, show profile selector, or proceed.
   */
  @Get()
  @HttpCode(200)
  @RateLimit({ namespace: 'profiles:list:user', limit: 60, windowMs: 60_000 })
  @ApiOperation({ summary: 'List profiles for the authenticated user' })
  @ApiResponse({
    status: 200,
    description: 'List of user profiles.',
    schema: {
      type: 'object',
      properties: {
        profiles: { type: 'array', items: { type: 'object' } },
        hasDefault: { type: 'boolean' },
        activeProfileId: { type: 'string', nullable: true },
      },
    },
  })
  @ApiResponse({ status: 401, description: 'Not authenticated' })
  async listProfiles(@Req() req: AuthenticatedRequest) {
    const userId = req.session.userId
    const result = await this.profilesService.getProfilesByUserId(userId)

    this.logger.debug(
      `User ${userId}: ${result.profiles.length} profile(s), default=${result.hasDefault}`,
    )

    return result
  }

  /**
   * POST /api/profiles/:id/set-default
   *
   * Sets a specific profile as the user's default. Only the profile
   * owner can set it as default.
   */
  @Post(':id/set-default')
  @HttpCode(200)
  @RateLimit({ namespace: 'profiles:set-default:user', limit: 20, windowMs: 60_000 })
  @ApiOperation({ summary: 'Set a profile as default' })
  @ApiResponse({ status: 200, description: 'Profile set as default.' })
  @ApiResponse({ status: 401, description: 'Not authenticated' })
  @ApiResponse({ status: 404, description: 'Profile not found' })
  async setDefaultProfile(
    @Param('id') profileId: string,
    @Req() req: AuthenticatedRequest,
  ): Promise<{ message: string }> {
    const userId = req.session.userId

    // Verify this profile belongs to the user
    const profile = await this.profilesService.getProfileById(profileId)
    if (!profile || profile.userId !== userId) {
      throw new HttpException(
        { statusCode: 404, error: ErrorCodes.NOT_FOUND_RESOURCE.code },
        404,
      )
    }

    // Clear any existing default for this user, set this one as default
    await this.profilesService.setDefaultProfile(userId, profileId)

    this.logger.log(`Profile ${profileId} set as default for user ${userId}`)
    return { message: 'Profile set as default.' }
  }
}
