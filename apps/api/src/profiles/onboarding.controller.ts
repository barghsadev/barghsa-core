import {
  Controller,
  Post,
  Body,
  Param,
  HttpCode,
  HttpException,
  Logger,
  Req,
  UseGuards,
} from '@nestjs/common'
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger'
import { ProfilesService } from './profiles.service.js'
import { SessionAuthGuard } from '../session/session.guard.js'
import type { AuthenticatedRequest } from '../session/session.guard.js'
import { RateLimit } from '../rate-limit/rate-limit.decorator.js'
import { ErrorCodes } from '@barghsa/shared/errors'

@ApiTags('Onboarding')
@Controller('api/onboarding')
@UseGuards(SessionAuthGuard)
export class OnboardingController {
  private readonly logger = new Logger(OnboardingController.name)

  constructor(private readonly profilesService: ProfilesService) {}

  /**
   * POST /api/onboarding/start
   *
   * Creates a draft profile for the authenticated user during
   * onboarding. The user selects Individual or Legal profile type
   * (T-03.02.01). Returns the new profile ID so the frontend can
   * redirect to the appropriate profile form.
   */
  @Post('start')
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
   * POST /api/onboarding/individual/:profileId
   *
   * Saves the individual profile fields (T-03.02.02). Expects the full
   * individual profile form data including the main address. Transitions
   * the profile from DRAFT to ACTIVE on success.
   */
  @Post('individual/:profileId')
  @HttpCode(200)
  @RateLimit({ namespace: 'onboarding:individual:user', limit: 20, windowMs: 60_000 })
  @ApiOperation({ summary: 'Save individual profile data' })
  @ApiResponse({
    status: 200,
    description: 'Individual profile saved.',
    schema: {
      type: 'object',
      properties: {
        id: { type: 'string' },
        profileType: { type: 'string' },
        isDefault: { type: 'boolean' },
        status: { type: 'string' },
        title: { type: 'string' },
        firstName: { type: 'string' },
        lastName: { type: 'string' },
        nationalId: { type: 'string' },
      },
    },
  })
  @ApiResponse({ status: 400, description: 'Validation error' })
  @ApiResponse({ status: 401, description: 'Not authenticated' })
  @ApiResponse({ status: 404, description: 'Profile not found' })
  @ApiResponse({ status: 409, description: 'National ID already registered' })
  async saveIndividualProfile(
    @Param('profileId') profileId: string,
    @Body() body: {
      title?: string
      firstName: string
      lastName: string
      nationalId: string
      provinceId: string
      cityId: string
      fullAddress: string
      postalCode: string
    },
    @Req() req: AuthenticatedRequest,
  ) {
    // Required field validation
    if (!body.firstName?.trim()) {
      throw new HttpException(
        { statusCode: 400, error: ErrorCodes.VALIDATION_INPUT_MISSING.code, message: 'First name is required' },
        400,
      )
    }
    if (!body.lastName?.trim()) {
      throw new HttpException(
        { statusCode: 400, error: ErrorCodes.VALIDATION_INPUT_MISSING.code, message: 'Last name is required' },
        400,
      )
    }
    if (!body.nationalId?.trim()) {
      throw new HttpException(
        { statusCode: 400, error: ErrorCodes.VALIDATION_INPUT_MISSING.code, message: 'National ID is required' },
        400,
      )
    }
    if (!body.provinceId?.trim()) {
      throw new HttpException(
        { statusCode: 400, error: ErrorCodes.VALIDATION_INPUT_MISSING.code, message: 'Province is required' },
        400,
      )
    }
    if (!body.cityId?.trim()) {
      throw new HttpException(
        { statusCode: 400, error: ErrorCodes.VALIDATION_INPUT_MISSING.code, message: 'City is required' },
        400,
      )
    }
    if (!body.fullAddress?.trim()) {
      throw new HttpException(
        { statusCode: 400, error: ErrorCodes.VALIDATION_INPUT_MISSING.code, message: 'Full address is required' },
        400,
      )
    }
    if (!body.postalCode?.trim()) {
      throw new HttpException(
        { statusCode: 400, error: ErrorCodes.VALIDATION_INPUT_MISSING.code, message: 'Postal code is required' },
        400,
      )
    }

    // Field length validation
    if (body.firstName.length > 100) {
      throw new HttpException(
        { statusCode: 400, error: ErrorCodes.VALIDATION_INPUT_INVALID.code, message: 'First name must be 100 characters or fewer' },
        400,
      )
    }
    if (body.lastName.length > 100) {
      throw new HttpException(
        { statusCode: 400, error: ErrorCodes.VALIDATION_INPUT_INVALID.code, message: 'Last name must be 100 characters or fewer' },
        400,
      )
    }
    if (body.fullAddress.length > 500) {
      throw new HttpException(
        { statusCode: 400, error: ErrorCodes.VALIDATION_INPUT_INVALID.code, message: 'Full address must be 500 characters or fewer' },
        400,
      )
    }
    if (body.title && body.title.length > 50) {
      throw new HttpException(
        { statusCode: 400, error: ErrorCodes.VALIDATION_INPUT_INVALID.code, message: 'Title must be 50 characters or fewer' },
        400,
      )
    }

    const profile = await this.profilesService.saveIndividualProfile(
      req.session.userId,
      profileId,
      {
        title: body.title?.trim() || undefined,
        firstName: body.firstName.trim(),
        lastName: body.lastName.trim(),
        nationalId: body.nationalId.trim(),
        provinceId: body.provinceId.trim(),
        cityId: body.cityId.trim(),
        fullAddress: body.fullAddress.trim(),
        postalCode: body.postalCode.trim(),
      },
    )

    this.logger.log(`Individual profile ${profileId} saved for user ${req.session.userId}`)

    return {
      id: profile.id,
      profileType: profile.profileType,
      isDefault: profile.isDefault,
      status: 'ACTIVE',
      title: profile.title,
      firstName: profile.firstName,
      lastName: profile.lastName,
      nationalId: profile.nationalId,
    }
  }
}