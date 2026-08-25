import {
  Controller,
  Get,
  Post,
  Body,
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
   * POST /api/onboarding/start
   *
   * Creates a draft profile for the authenticated user during
   * onboarding. The user selects Individual or Legal profile type
   * (T-03.02.01). Returns the new profile ID so the frontend can
   * redirect to the appropriate profile form.
   */
  @Post('onboarding/start')
  @HttpCode(201)
  @RateLimit({ namespace: 'onboarding:start:user', limit: 10, windowMs: 60_000 })
  @ApiOperation({ summary: 'Start onboarding — create a draft profile' })
  @ApiResponse({
    status: 201,
    description: 'Draft profile created.',
    schema: {
      type: 'object',
      properties: {
        profileId: { type: 'string' },
        profileType: { type: 'string', enum: ['INDIVIDUAL', 'LEGAL'] },
        isDefault: { type: 'boolean' },
      },
    },
  })
  @ApiResponse({ status: 400, description: 'Invalid profile type' })
  @ApiResponse({ status: 401, description: 'Not authenticated' })
  async startOnboarding(
    @Body() body: { profileType: string },
    @Req() req: AuthenticatedRequest,
  ): Promise<{ profileId: string; profileType: 'INDIVIDUAL' | 'LEGAL'; isDefault: boolean }> {
    const profileType = body.profileType?.toUpperCase()

    if (profileType !== 'INDIVIDUAL' && profileType !== 'LEGAL') {
      throw new HttpException(
        {
          statusCode: 400,
          error: ErrorCodes.VALIDATION_INPUT_INVALID.code,
          message: 'profileType must be INDIVIDUAL or LEGAL',
        },
        400,
      )
    }

    const profile = await this.profilesService.createProfile(
      req.session.userId,
      profileType,
    )

    this.logger.log(
      `Onboarding started for user ${req.session.userId}: profile ${profile.id} (${profileType})`,
    )

    return {
      profileId: profile.id,
      profileType: profile.profileType,
      isDefault: profile.isDefault,
    }
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

  /**
   * GET /api/profiles/verification-status
   *
   * Returns the verification context for the authenticated user's
   * active (default) profile. The frontend uses this to show/hide
   * the verification banner, auto-verify button, and block new
   * commercial orders (T-03.01.02).
   *
   * Response fields:
   * - `activeProfileId` — the user's default profile ID (null if none)
   * - `profileStatus` — profile lifecycle status (null if no profile)
   * - `isVerified` — whether the active profile is VERIFIED
   * - `verificationRequired` — whether the system requires verification
   * - `verificationMethod` — configured method ('api' | 'manual')
   * - `canAutoVerify` — true when api method is available and profile is not verified
   */
  @Get('verification-status')
  @HttpCode(200)
  @RateLimit({ namespace: 'profiles:verification:status', limit: 60, windowMs: 60_000 })
  @ApiOperation({ summary: 'Get profile verification status for the authenticated user' })
  @ApiResponse({
    status: 200,
    description: 'Verification status context.',
    schema: {
      type: 'object',
      properties: {
        activeProfileId: { type: 'string', nullable: true },
        profileStatus: { type: 'string', nullable: true },
        isVerified: { type: 'boolean' },
        verificationRequired: { type: 'boolean' },
        verificationMethod: { type: 'string', enum: ['api', 'manual'] },
        canAutoVerify: { type: 'boolean' },
      },
    },
  })
  @ApiResponse({ status: 401, description: 'Not authenticated' })
  async getVerificationStatus(@Req() req: AuthenticatedRequest) {
    const userId = req.session.userId
    const result = await this.profilesService.getVerificationStatus(userId)

    this.logger.debug(
      `User ${userId}: verification status — verified=${result.isVerified}, required=${result.verificationRequired}, method=${result.verificationMethod}`,
    )

    return result
  }

  /**
   * POST /api/profiles/:id/verify
   *
   * Auto-verify a profile via the API method. Only works when the
   * system verification method is 'api' and the profile is not yet
   * verified. This is a stub pending E-07 verification settings
   * integration and marks the profile as VERIFIED directly.
   */
  @Post(':id/verify')
  @HttpCode(200)
  @RateLimit({ namespace: 'profiles:verify:user', limit: 10, windowMs: 60_000 })
  @ApiOperation({ summary: 'Auto-verify a profile via API method' })
  @ApiResponse({ status: 200, description: 'Profile verified successfully.' })
  @ApiResponse({ status: 401, description: 'Not authenticated' })
  @ApiResponse({ status: 403, description: 'Verification not allowed' })
  @ApiResponse({ status: 404, description: 'Profile not found' })
  async verifyProfile(
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

    // Verify the profile is not already verified
    if (profile.status === 'VERIFIED') {
      throw new HttpException(
        {
          statusCode: 409,
          error: ErrorCodes.CONFLICT_STATE.code,
        },
        409,
      )
    }

    // Verify the system method is 'api' — the service handles this check
    try {
      await this.profilesService.verifyProfileApi(userId, profileId)
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Verification failed'
      throw new HttpException(
        { statusCode: 403, error: ErrorCodes.AUTHZ_FORBIDDEN.code, message },
        403,
      )
    }

    this.logger.log(`Profile ${profileId} verified for user ${userId}`)
    return { message: 'Profile verified successfully.' }
  }
}