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
import { LegalProfilesService } from './legal-profiles.service.js'
import { SessionAuthGuard } from '../session/session.guard.js'
import type { AuthenticatedRequest } from '../session/session.guard.js'
import { RateLimit } from '../rate-limit/rate-limit.decorator.js'
import { ErrorCodes } from '@barghsa/shared/errors'

@ApiTags('Onboarding')
@Controller('api/onboarding')
@UseGuards(SessionAuthGuard)
export class OnboardingController {
  private readonly logger = new Logger(OnboardingController.name)

  constructor(
    private readonly profilesService: ProfilesService,
    private readonly legalProfilesService: LegalProfilesService,
  ) {}

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

  /**
   * POST /api/onboarding/legal/:profileId
   *
   * Saves the legal profile fields (T-03.02.03) for a legal entity profile,
   * including the authorized representative's fields and legal entity data.
   * Transitions the profile from DRAFT to ACTIVE on success.
   */
  @Post('legal/:profileId')
  @HttpCode(200)
  @RateLimit({ namespace: 'onboarding:legal:user', limit: 20, windowMs: 60_000 })
  @ApiOperation({ summary: 'Save legal profile data' })
  @ApiResponse({
    status: 200,
    description: 'Legal profile saved.',
    schema: {
      type: 'object',
      properties: {
        id: { type: 'string' },
        profileType: { type: 'string' },
        isDefault: { type: 'boolean' },
        status: { type: 'string' },
        title: { type: 'string' },
      },
    },
  })
  @ApiResponse({ status: 400, description: 'Validation error' })
  @ApiResponse({ status: 401, description: 'Not authenticated' })
  @ApiResponse({ status: 404, description: 'Profile not found' })
  @ApiResponse({ status: 409, description: 'National identifier already registered' })
  async saveLegalProfile(
    @Param('profileId') profileId: string,
    @Body() body: {
      legalName: string
      nationalIdentifier: string
      registrationNumber: string
      companyTypeId?: string
      registrationDate?: string
      economicCode?: string
      officialPhone?: string
      officialEmail?: string
      officialProvinceId?: string
      officialCityId?: string
      officialFullAddress?: string
      officialPostalCode?: string
      representativeTitle: string
      representativeRelationship: string
    },
    @Req() req: AuthenticatedRequest,
  ) {
    // Required field validation
    if (!body.legalName?.trim()) {
      throw new HttpException(
        { statusCode: 400, error: ErrorCodes.VALIDATION_INPUT_MISSING.code, message: 'Legal name is required' },
        400,
      )
    }
    if (!body.nationalIdentifier?.trim()) {
      throw new HttpException(
        { statusCode: 400, error: ErrorCodes.VALIDATION_INPUT_MISSING.code, message: 'National identifier is required' },
        400,
      )
    }
    if (!body.registrationNumber?.trim()) {
      throw new HttpException(
        { statusCode: 400, error: ErrorCodes.VALIDATION_INPUT_MISSING.code, message: 'Registration number is required' },
        400,
      )
    }
    if (!body.representativeTitle?.trim()) {
      throw new HttpException(
        { statusCode: 400, error: ErrorCodes.VALIDATION_INPUT_MISSING.code, message: 'Representative title is required' },
        400,
      )
    }
    if (!body.representativeRelationship?.trim()) {
      throw new HttpException(
        { statusCode: 400, error: ErrorCodes.VALIDATION_INPUT_MISSING.code, message: 'Representative relationship is required' },
        400,
      )
    }

    // Field length validation
    if (body.legalName.length > 200) {
      throw new HttpException(
        { statusCode: 400, error: ErrorCodes.VALIDATION_INPUT_INVALID.code, message: 'Legal name must be 200 characters or fewer' },
        400,
      )
    }
    if (body.registrationNumber.length > 50) {
      throw new HttpException(
        { statusCode: 400, error: ErrorCodes.VALIDATION_INPUT_INVALID.code, message: 'Registration number must be 50 characters or fewer' },
        400,
      )
    }
    if (body.representativeTitle.length > 100) {
      throw new HttpException(
        { statusCode: 400, error: ErrorCodes.VALIDATION_INPUT_INVALID.code, message: 'Representative title must be 100 characters or fewer' },
        400,
      )
    }
    if (body.representativeRelationship.length > 100) {
      throw new HttpException(
        { statusCode: 400, error: ErrorCodes.VALIDATION_INPUT_INVALID.code, message: 'Representative relationship must be 100 characters or fewer' },
        400,
      )
    }
    if (body.officialFullAddress && body.officialFullAddress.length > 500) {
      throw new HttpException(
        { statusCode: 400, error: ErrorCodes.VALIDATION_INPUT_INVALID.code, message: 'Official full address must be 500 characters or fewer' },
        400,
      )
    }

    const profile = await this.legalProfilesService.saveLegalProfile(
      req.session.userId,
      profileId,
      {
        legalName: body.legalName.trim(),
        nationalIdentifier: body.nationalIdentifier.trim(),
        registrationNumber: body.registrationNumber.trim(),
        companyTypeId: body.companyTypeId?.trim() || undefined,
        registrationDate: body.registrationDate?.trim() || undefined,
        economicCode: body.economicCode?.trim() || undefined,
        officialPhone: body.officialPhone?.trim() || undefined,
        officialEmail: body.officialEmail?.trim() || undefined,
        officialProvinceId: body.officialProvinceId?.trim() || undefined,
        officialCityId: body.officialCityId?.trim() || undefined,
        officialFullAddress: body.officialFullAddress?.trim() || undefined,
        officialPostalCode: body.officialPostalCode?.trim() || undefined,
        representativeTitle: body.representativeTitle.trim(),
        representativeRelationship: body.representativeRelationship.trim(),
      },
    )

    this.logger.log(`Legal profile ${profileId} saved for user ${req.session.userId}`)

    return {
      id: profile.id,
      profileType: profile.profileType,
      isDefault: profile.isDefault,
      status: 'ACTIVE',
      title: profile.title,
    }
  }

  /**
   * POST /api/onboarding/complete/:profileId
   *
   * Finalizes the onboarding for a profile (T-03.02.04). Transitions
   * the profile from DRAFT to ACTIVE or PENDING_VERIFICATION depending
   * on system verification settings. Sets the profile as default if
   * the user has no default profile yet. Idempotent — safe to call
   * even after the profile is already ACTIVE.
   */
  @Post('complete/:profileId')
  @HttpCode(200)
  @RateLimit({ namespace: 'onboarding:complete:user', limit: 20, windowMs: 60_000 })
  @ApiOperation({ summary: 'Complete onboarding — finalize profile' })
  @ApiResponse({
    status: 200,
    description: 'Onboarding completed.',
    schema: {
      type: 'object',
      properties: {
        id: { type: 'string' },
        profileType: { type: 'string' },
        isDefault: { type: 'boolean' },
        status: { type: 'string' },
        message: { type: 'string' },
      },
    },
  })
  @ApiResponse({ status: 401, description: 'Not authenticated' })
  @ApiResponse({ status: 404, description: 'Profile not found' })
  async completeOnboarding(
    @Param('profileId') profileId: string,
    @Req() req: AuthenticatedRequest,
  ) {
    const profile = await this.profilesService.completeOnboarding(
      req.session.userId,
      profileId,
    )

    this.logger.log(
      `Onboarding completed for profile ${profileId} by user ${req.session.userId} (status=${profile.status})`,
    )

    return {
      id: profile.id,
      profileType: profile.profileType,
      isDefault: profile.isDefault,
      status: profile.status,
      message: 'Onboarding completed successfully',
    }
  }
}