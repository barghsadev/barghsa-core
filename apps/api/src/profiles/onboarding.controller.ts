import { ApiZodBody } from '../openapi/zod-body.decorator.js';
import {
  OnboardingJourneysService,
  onboardingJourneyInputSchema,
  onboardingJourneyFinishSchema,
} from './onboarding-journeys.service.js';
import {
  OnboardingDraftsService,
  onboardingDraftInputSchema,
} from './onboarding-drafts.service.js';
import { z } from 'zod';
import {
  Controller,
  Post,
  Get,
  Put,
  Body,
  Param,
  HttpCode,
  HttpException,
  Logger,
  Req,
  UseGuards,
  ParseUUIDPipe,
} from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import type { ApiResponseSchemaHost } from '@nestjs/swagger';
import { ProfilesService } from './profiles.service.js';
import { LegalProfilesService } from './legal-profiles.service.js';
import { SessionAuthGuard } from '../session/session.guard.js';
import type { AuthenticatedRequest } from '../session/session.guard.js';
import { RateLimit } from '../rate-limit/rate-limit.decorator.js';
import { ErrorCodes } from '@barghsa/shared/errors';

const individualOnboardingInputSchema = z.object({
  draftVersion: z.number().int().min(0).max(2147483647).optional(),
  title: z.string().trim().max(50).optional(),
  firstName: z.string().trim().min(1).max(100),
  lastName: z.string().trim().min(1).max(100),
  nationalId: z.string().trim(),
  provinceId: z.string().uuid(),
  cityId: z.string().uuid(),
  fullAddress: z.string().trim().min(1).max(500),
  postalCode: z.string().trim(),
});

const journeyResponseSchema: ApiResponseSchemaHost['schema'] = {
  type: 'object',
  required: ['id', 'profiles', 'completed', 'selectedProfileId', 'activeProfileId'],
  properties: {
    id: { type: 'string', format: 'uuid' },
    completed: { type: 'boolean' },
    selectedProfileId: { type: 'string', format: 'uuid', nullable: true },
    activeProfileId: { type: 'string', format: 'uuid', nullable: true },
    profiles: {
      type: 'array',
      minItems: 1,
      maxItems: 2,
      items: {
        type: 'object',
        required: ['id', 'profileType', 'status', 'isDefault', 'title', 'firstName', 'lastName'],
        properties: {
          id: { type: 'string', format: 'uuid' },
          profileType: { type: 'string', enum: ['INDIVIDUAL', 'LEGAL'] },
          status: { type: 'string', enum: ['DRAFT', 'ACTIVE', 'PENDING_VERIFICATION', 'VERIFIED'] },
          isDefault: { type: 'boolean' },
          title: { type: 'string', nullable: true },
          firstName: { type: 'string', nullable: true },
          lastName: { type: 'string', nullable: true },
        },
      },
    },
  },
};

@ApiTags('Onboarding')
@Controller('api/onboarding')
@UseGuards(SessionAuthGuard)
export class OnboardingController {
  private readonly logger = new Logger(OnboardingController.name);

  constructor(
    private readonly profilesService: ProfilesService,
    private readonly legalProfilesService: LegalProfilesService,
    private readonly drafts: OnboardingDraftsService,
    private readonly journeys: OnboardingJourneysService
  ) {}

  @Get('journeys/active')
  @RateLimit({ namespace: 'onboarding:journey:get:user', limit: 60, windowMs: 60000 })
  @ApiOperation({ summary: 'Read the unfinished profile setup' })
  @ApiResponse({
    status: 200,
    schema: {
      type: 'object',
      required: ['journey'],
      properties: { journey: { ...journeyResponseSchema, nullable: true } },
    },
  })
  activeJourney(@Req() req: AuthenticatedRequest) {
    return this.journeys.active(req.session.userId);
  }

  @Get('journeys/:journeyId')
  @RateLimit({ namespace: 'onboarding:journey:get:user', limit: 60, windowMs: 60000 })
  @ApiOperation({ summary: 'Read an owned profile setup and its profiles' })
  @ApiResponse({ status: 200, schema: journeyResponseSchema })
  getJourney(
    @Param('journeyId', new ParseUUIDPipe()) journeyId: string,
    @Req() req: AuthenticatedRequest
  ) {
    return this.journeys.get(req.session.userId, journeyId);
  }

  @Post('journeys')
  @ApiZodBody(onboardingJourneyInputSchema)
  @RateLimit({ namespace: 'onboarding:journey:start:user', limit: 10, windowMs: 60000 })
  @ApiOperation({ summary: 'Start or resume personal, company, or combined profile setup' })
  @ApiResponse({ status: 201, schema: journeyResponseSchema })
  startJourney(@Body() body: unknown, @Req() req: AuthenticatedRequest) {
    return this.journeys.start(req.session, body);
  }

  @Post('journeys/:journeyId/finish')
  @HttpCode(200)
  @ApiZodBody(onboardingJourneyFinishSchema)
  @RateLimit({ namespace: 'onboarding:journey:finish:user', limit: 20, windowMs: 60000 })
  @ApiOperation({ summary: 'Finish profile setup and select the dashboard profile' })
  @ApiResponse({ status: 200, schema: journeyResponseSchema })
  finishJourney(
    @Param('journeyId', new ParseUUIDPipe()) journeyId: string,
    @Body() body: unknown,
    @Req() req: AuthenticatedRequest
  ) {
    return this.journeys.finish(req.session, journeyId, body);
  }

  @Get('documents/:profileId')
  @RateLimit({ namespace: 'onboarding:documents:user', limit: 30, windowMs: 60000 })
  @ApiOperation({ summary: 'Download the owned legal profile documents' })
  getDocuments(
    @Param('profileId', new ParseUUIDPipe()) profileId: string,
    @Req() req: AuthenticatedRequest
  ) {
    return this.legalProfilesService.getDocuments(req.session.userId, profileId);
  }

  @Get('draft/:profileId')
  @RateLimit({ namespace: 'onboarding:draft:get:user', limit: 60, windowMs: 60000 })
  @ApiOperation({ summary: 'Read the current owned onboarding draft' })
  getDraft(
    @Param('profileId', new ParseUUIDPipe()) profileId: string,
    @Req() req: AuthenticatedRequest
  ) {
    return this.drafts.get(req.session, profileId);
  }

  @Put('draft/:profileId')
  @ApiZodBody(onboardingDraftInputSchema)
  @RateLimit({ namespace: 'onboarding:draft:save:user', limit: 60, windowMs: 60000 })
  @ApiOperation({ summary: 'Save onboarding fields with a draft version check' })
  saveDraft(
    @Param('profileId', new ParseUUIDPipe()) profileId: string,
    @Body() body: unknown,
    @Req() req: AuthenticatedRequest
  ) {
    return this.drafts.save(req.session, profileId, body);
  }

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
    @Body() body: unknown,
    @Req() req: AuthenticatedRequest
  ): Promise<{ profileId: string; profileType: 'INDIVIDUAL' | 'LEGAL'; isDefault: boolean }> {
    const parsed = z
      .object({
        profileType: z
          .string()
          .transform((value) => value.toUpperCase())
          .pipe(z.enum(['INDIVIDUAL', 'LEGAL'])),
      })
      .safeParse(body);
    const profileType = parsed.success ? parsed.data.profileType : undefined;

    if (profileType !== 'INDIVIDUAL' && profileType !== 'LEGAL') {
      throw new HttpException(
        {
          statusCode: 400,
          error: ErrorCodes.VALIDATION_INPUT_INVALID.code,
          message: 'profileType must be INDIVIDUAL or LEGAL',
        },
        400
      );
    }

    const profile = await this.profilesService.createProfile(req.session.userId, profileType);

    this.logger.log(
      `Onboarding started for user ${req.session.userId}: profile ${profile.id} (${profileType})`
    );

    return {
      profileId: profile.id,
      profileType: profile.profileType,
      isDefault: profile.isDefault,
    };
  }

  /**
   * POST /api/onboarding/individual/:profileId
   *
   * Saves the individual profile fields (T-03.02.02). Expects the full
   * individual profile form data including the main address. Transitions
   * the profile from DRAFT to ACTIVE on success.
   */
  @ApiZodBody(individualOnboardingInputSchema)
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
    @Param('profileId', new ParseUUIDPipe()) profileId: string,
    @Body() body: unknown,
    @Req() req: AuthenticatedRequest
  ) {
    const parsed = individualOnboardingInputSchema.safeParse(body);
    if (!parsed.success) {
      throw new HttpException(
        {
          statusCode: 400,
          error: ErrorCodes.VALIDATION_INPUT_INVALID.code,
          message: parsed.error.issues[0]?.message ?? 'Invalid individual profile data',
        },
        400
      );
    }
    const profile = await this.profilesService.saveIndividualProfile(
      req.session.userId,
      profileId,
      parsed.data
    );

    this.logger.log(`Individual profile ${profileId} saved for user ${req.session.userId}`);

    return {
      id: profile.id,
      profileType: profile.profileType,
      isDefault: profile.isDefault,
      status: profile.status,
      title: profile.title,
      firstName: profile.firstName,
      lastName: profile.lastName,
      nationalId: profile.nationalId,
    };
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
    @Param('profileId', new ParseUUIDPipe()) profileId: string,
    @Body() body: unknown,
    @Req() req: AuthenticatedRequest
  ) {
    const profile = await this.legalProfilesService.saveLegalProfile(
      req.session.userId,
      profileId,
      body
    );

    this.logger.log(`Legal profile ${profileId} saved for user ${req.session.userId}`);

    return {
      id: profile.id,
      profileType: profile.profileType,
      isDefault: profile.isDefault,
      status: profile.status,
      title: profile.title,
    };
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
        title: { type: 'string', nullable: true },
        firstName: { type: 'string', nullable: true },
        lastName: { type: 'string', nullable: true },
        message: { type: 'string' },
        journey: { ...journeyResponseSchema, nullable: true },
      },
    },
  })
  @ApiResponse({ status: 401, description: 'Not authenticated' })
  @ApiResponse({ status: 404, description: 'Profile not found' })
  async completeOnboarding(
    @Param('profileId', new ParseUUIDPipe()) profileId: string,
    @Req() req: AuthenticatedRequest
  ) {
    const profile = await this.profilesService.completeOnboarding(req.session.userId, profileId);

    this.logger.log(
      `Onboarding completed for profile ${profileId} by user ${req.session.userId} (status=${profile.status})`
    );

    return {
      id: profile.id,
      profileType: profile.profileType,
      isDefault: profile.isDefault,
      status: profile.status,
      title: profile.title,
      firstName: profile.firstName,
      lastName: profile.lastName,
      message: 'Onboarding completed successfully',
      journey: await this.journeys.forProfile(req.session.userId, profileId),
    };
  }
}
