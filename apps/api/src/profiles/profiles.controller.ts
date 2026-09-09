import { ApiZodBody } from '../openapi/zod-body.decorator.js';
import {
  Body,
  Controller,
  Delete,
  Get,
  Post,
  Put,
  HttpCode,
  HttpException,
  Logger,
  Param,
  ParseUUIDPipe,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { ProfilesService } from './profiles.service.js';
import { AgentsService } from './agents.service.js';
import { RequiresStepUp, StepUpGuard } from '../session/step-up.guard.js';
import { z } from 'zod';
import { SessionAuthGuard } from '../session/session.guard.js';
import type { AuthenticatedRequest } from '../session/session.guard.js';
import { RateLimit } from '../rate-limit/rate-limit.decorator.js';
import { ErrorCodes } from '@barghsa/shared/errors';
import {
  validateNationalId,
  validatePostalCode,
  validateLegalNationalIdentifier,
} from '@barghsa/shared/validation';

const addressFields = z.object({
  provinceId: z.string().trim().uuid(),
  cityId: z.string().trim().uuid(),
  fullAddress: z.string().trim().min(1).max(500),
  postalCode: z.string().trim().refine(validatePostalCode),
});
const createAddressInput = addressFields.extend({ mainAddress: z.boolean().optional() });
const updateAddressInput = addressFields.partial().refine((data) => Object.keys(data).length > 0);

const updateProfileInput = addressFields
  .partial()
  .extend({
    title: z.string().trim().max(50).optional(),
    firstName: z.string().trim().min(1).max(100).optional(),
    lastName: z.string().trim().min(1).max(100).optional(),
    nationalId: z.string().trim().refine(validateNationalId).optional(),
    legalName: z.string().trim().min(1).max(200).optional(),
    nationalIdentifier: z.string().trim().refine(validateLegalNationalIdentifier).optional(),
  })
  .refine((data) => Object.keys(data).length > 0)
  .refine((data) => {
    const values = [data.provinceId, data.cityId, data.fullAddress, data.postalCode];
    return (
      values.every((value) => value === undefined) || values.every((value) => value !== undefined)
    );
  });

@ApiTags('Profiles')
@Controller('api/profiles')
@UseGuards(SessionAuthGuard)
export class ProfilesController {
  private readonly logger = new Logger(ProfilesController.name);

  constructor(
    private readonly profilesService: ProfilesService,
    private readonly agentsService: AgentsService
  ) {}

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
    const userId = req.session.userId;
    const result = await this.profilesService.getProfilesByUserId(userId);

    this.logger.debug(
      `User ${userId}: ${result.profiles.length} profile(s), default=${result.hasDefault}`
    );

    return result;
  }

  /**
   * POST /api/profiles/switch/:profileId
   *
   * Switches the user's active profile. The active profile is the one whose
   * data the app dashboard displays. Used by the sidebar profile switcher
   * (T-03.03.01).
   *
   * Enforcement: the user must have access to the target profile — either as
   * the owner (`userId` matches) or as an active agent. Agent membership is
   * tracked by a future profile-agents ledger; until that exists only the
   * owner-access path is active, but the check is centralized here so the
   * agent path can be added without touching callers or the frontend.
   */
  @Post('switch/:profileId')
  @HttpCode(200)
  @RateLimit({ namespace: 'profiles:switch:user', limit: 30, windowMs: 60_000 })
  @ApiOperation({ summary: 'Switch the active profile' })
  @ApiResponse({
    status: 200,
    description: 'Active profile switched.',
    schema: { type: 'object', properties: { activeProfileId: { type: 'string', nullable: true } } },
  })
  @ApiResponse({ status: 401, description: 'Not authenticated' })
  @ApiResponse({ status: 403, description: 'User does not have access to the profile' })
  @ApiResponse({ status: 404, description: 'Profile not found' })
  async switchProfile(
    @Param('profileId') profileId: string,
    @Req() req: AuthenticatedRequest
  ): Promise<{ activeProfileId: string | null }> {
    const userId = req.session.userId;

    // Verify this profile belongs to the user (or they are an active agent).
    const profile = await this.profilesService.getAccessibleProfile(userId, profileId);
    if (!profile) {
      throw new HttpException({ statusCode: 404, error: ErrorCodes.NOT_FOUND_RESOURCE.code }, 404);
    }

    // Clear any existing default for this user, set this one as default.
    await this.profilesService.setDefaultProfile(userId, profileId);

    this.logger.log(`User ${userId} switched active profile to ${profileId}`);
    return { activeProfileId: profileId };
  }

  /**
   * POST /api/profiles/default/:profileId
   *
   * Persist the current user's choice among owned and active-agent profiles.
   */
  @Post('default/:profileId')
  @HttpCode(200)
  @RateLimit({ namespace: 'profiles:set-default:user', limit: 20, windowMs: 60_000 })
  @ApiOperation({ summary: 'Choose a default from accessible profiles' })
  @ApiResponse({
    status: 200,
    description: 'Default profile saved for the authenticated user.',
    schema: { type: 'object', properties: { activeProfileId: { type: 'string' } } },
  })
  @ApiResponse({ status: 400, description: 'Invalid profile identifier.' })
  @ApiResponse({ status: 401, description: 'Not authenticated.' })
  @ApiResponse({ status: 404, description: 'Profile is unavailable to this user.' })
  async chooseDefaultProfile(
    @Param('profileId', new ParseUUIDPipe()) profileId: string,
    @Req() req: AuthenticatedRequest
  ): Promise<{ activeProfileId: string }> {
    await this.profilesService.setDefaultProfile(req.session.userId, profileId);
    return { activeProfileId: profileId };
  }

  /** Legacy owner-only default selection route. */
  @Post(':id/set-default')
  @HttpCode(200)
  @RateLimit({ namespace: 'profiles:set-default:user', limit: 20, windowMs: 60_000 })
  @ApiOperation({ summary: 'Set a profile as default' })
  @ApiResponse({ status: 200, description: 'Profile set as default.' })
  @ApiResponse({ status: 401, description: 'Not authenticated' })
  @ApiResponse({ status: 404, description: 'Profile not found' })
  async setDefaultProfile(
    @Param('id') profileId: string,
    @Req() req: AuthenticatedRequest
  ): Promise<{ message: string }> {
    const userId = req.session.userId;

    // Verify this profile belongs to the user
    const profile = await this.profilesService.getProfileById(profileId);
    if (!profile || profile.userId !== userId) {
      throw new HttpException({ statusCode: 404, error: ErrorCodes.NOT_FOUND_RESOURCE.code }, 404);
    }

    // Clear any existing default for this user, set this one as default
    await this.profilesService.setDefaultProfile(userId, profileId);

    this.logger.log(`Profile ${profileId} set as default for user ${userId}`);
    return { message: 'Profile set as default.' };
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
    const userId = req.session.userId;
    const result = await this.profilesService.getVerificationStatus(userId);

    this.logger.debug(
      `User ${userId}: verification status — verified=${result.isVerified}, required=${result.verificationRequired}, method=${result.verificationMethod}`
    );

    return result;
  }

  /**
   * POST /api/profiles/:id/verify
   *
   * External verification is unavailable until a real provider is configured.
   */
  @Post(':id/verify')
  @HttpCode(200)
  @RateLimit({ namespace: 'profiles:verify:user', limit: 10, windowMs: 60_000 })
  @ApiOperation({ summary: 'Auto-verify a profile via API method' })
  @ApiResponse({ status: 503, description: 'Identity verification provider unavailable.' })
  @ApiResponse({ status: 401, description: 'Not authenticated' })
  @ApiResponse({ status: 403, description: 'Verification not allowed' })
  @ApiResponse({ status: 404, description: 'Profile not found' })
  async verifyProfile(
    @Param('id') profileId: string,
    @Req() req: AuthenticatedRequest
  ): Promise<{ message: string }> {
    const userId = req.session.userId;

    // Verify this profile belongs to the user
    const profile = await this.profilesService.getProfileById(profileId);
    if (!profile || profile.userId !== userId) {
      throw new HttpException({ statusCode: 404, error: ErrorCodes.NOT_FOUND_RESOURCE.code }, 404);
    }

    // Verify the profile is not already verified
    if (profile.status === 'VERIFIED') {
      throw new HttpException(
        {
          statusCode: 409,
          error: ErrorCodes.CONFLICT_STATE.code,
        },
        409
      );
    }

    return this.profilesService.verifyProfileApi(userId, profileId);
  }

  @Get('ownership-transfers')
  @HttpCode(200)
  async listOwnershipTransfers(@Req() req: AuthenticatedRequest) {
    return this.agentsService.listOwnershipTransfers(req.session.userId);
  }

  @Post(':profileId/ownership-accept')
  @HttpCode(200)
  @RequiresStepUp()
  @UseGuards(StepUpGuard)
  async acceptOwnership(
    @Param('profileId') profileId: string,
    @Body() body: unknown,
    @Req() req: AuthenticatedRequest
  ) {
    return this.resolveOwnership(profileId, body, req, 'accept');
  }

  @Post(':profileId/ownership-decline')
  @HttpCode(200)
  @RequiresStepUp()
  @UseGuards(StepUpGuard)
  async declineOwnership(
    @Param('profileId') profileId: string,
    @Body() body: unknown,
    @Req() req: AuthenticatedRequest
  ) {
    return this.resolveOwnership(profileId, body, req, 'decline');
  }

  @Post(':profileId/ownership-cancel')
  @HttpCode(200)
  @RequiresStepUp()
  @UseGuards(StepUpGuard)
  async cancelOwnership(
    @Param('profileId') profileId: string,
    @Body() body: unknown,
    @Req() req: AuthenticatedRequest
  ) {
    return this.resolveOwnership(profileId, body, req, 'cancel');
  }

  private resolveOwnership(
    profileId: string,
    body: unknown,
    req: AuthenticatedRequest,
    decision: 'accept' | 'decline' | 'cancel'
  ) {
    const parsed = z.object({ transferId: z.uuid() }).safeParse(body);
    if (!parsed.success || !z.uuid().safeParse(profileId).success) {
      throw new HttpException(
        { statusCode: 400, error: ErrorCodes.VALIDATION_INPUT_INVALID.code },
        400
      );
    }
    return this.agentsService.resolveOwnershipTransfer(
      profileId,
      parsed.data.transferId,
      req.session,
      decision
    );
  }

  /**
   * GET /api/profiles/:id
   *
   * Returns full profile details including addresses and legal entity
   * information (if the profile is a legal entity). Used by the profile
   * settings page (T-03.03.03).
   */
  @Get(':id')
  @HttpCode(200)
  @RateLimit({ namespace: 'profiles:get:user', limit: 60, windowMs: 60_000 })
  @ApiOperation({ summary: 'Get profile details with addresses and legal info' })
  @ApiResponse({ status: 200, description: 'Profile details.' })
  @ApiResponse({ status: 401, description: 'Not authenticated' })
  @ApiResponse({ status: 404, description: 'Profile not found' })
  async getProfile(@Param('id') profileId: string, @Req() req: AuthenticatedRequest) {
    const userId = req.session.userId;

    const profile = await this.profilesService.getProfileById(profileId);
    if (!profile || profile.userId !== userId) {
      throw new HttpException({ statusCode: 404, error: ErrorCodes.NOT_FOUND_RESOURCE.code }, 404);
    }

    // Fetch addresses
    const addresses = await this.profilesService.getProfileAddresses(profileId);

    // For legal profiles, fetch legal entity data
    let legalInfo: Record<string, unknown> | null = null;
    if (profile.profileType === 'LEGAL') {
      legalInfo = await this.profilesService.getLegalProfileInfo(profileId);
    }

    return {
      canEditIdentity: await this.profilesService.canEditIndividualIdentity(userId, profile),
      id: profile.id,
      profileType: profile.profileType,
      isDefault: profile.isDefault,
      status: profile.status,
      title: profile.title,
      firstName: profile.firstName,
      lastName: profile.lastName,
      nationalId: profile.nationalId,
      createdAt: profile.createdAt,
      updatedAt: profile.updatedAt,
      addresses,
      legalInfo,
    };
  }

  /**
   * PUT /api/profiles/:id
   *
   * Updates editable profile fields. Address fields are editable; identity
   * fields (first name, last name, national ID for individuals; legal name,
   * national identifier for legal entities) are read-only after verification.
   * Staff can always update their own individual profile.
   *
   * Address changes create a new address record (historical addresses retained).
   */
  @Put(':id')
  @HttpCode(200)
  @RateLimit({ namespace: 'profiles:update:user', limit: 30, windowMs: 60_000 })
  @ApiOperation({ summary: 'Update profile fields' })
  @ApiZodBody(updateProfileInput)
  @ApiResponse({ status: 200, description: 'Profile updated.' })
  @ApiResponse({ status: 400, description: 'Validation error' })
  @ApiResponse({ status: 401, description: 'Not authenticated' })
  @ApiResponse({ status: 403, description: 'Field is read-only after verification' })
  @ApiResponse({ status: 404, description: 'Profile not found' })
  async updateProfile(
    @Param('id', new ParseUUIDPipe()) profileId: string,
    @Body() body: unknown,
    @Req() req: AuthenticatedRequest
  ) {
    const userId = req.session.userId;

    const parsed = updateProfileInput.safeParse(body);
    if (!parsed.success)
      throw new HttpException(
        { statusCode: 400, error: ErrorCodes.VALIDATION_INPUT_INVALID.code },
        400
      );
    const updated = await this.profilesService.updateProfile(req.session, profileId, parsed.data);

    this.logger.log(`Profile ${profileId} updated for user ${userId}`);

    return {
      id: updated.id,
      profileType: updated.profileType,
      isDefault: updated.isDefault,
      status: updated.status,
      title: updated.title,
      firstName: updated.firstName,
      lastName: updated.lastName,
      nationalId: updated.nationalId,
      updatedAt: updated.updatedAt,
    };
  }

  /**
   * GET /api/profiles/:profileId/addresses
   *
   * Returns all addresses for the specified profile. The main address
   * is listed first. The user must own the profile.
   */
  @Get(':profileId/addresses')
  @HttpCode(200)
  @RateLimit({ namespace: 'profiles:addresses:list:user', limit: 60, windowMs: 60_000 })
  @ApiOperation({ summary: 'List addresses for a profile' })
  @ApiResponse({ status: 200, description: 'List of addresses.' })
  @ApiResponse({ status: 401, description: 'Not authenticated' })
  @ApiResponse({ status: 404, description: 'Profile not found' })
  async listAddresses(
    @Param('profileId', new ParseUUIDPipe()) profileId: string,
    @Req() req: AuthenticatedRequest
  ) {
    const userId = req.session.userId;

    await this.profilesService.requireAddressEditor(userId, profileId);

    const addresses = await this.profilesService.getProfileAddresses(profileId);
    return { addresses };
  }

  /**
   * POST /api/profiles/:profileId/addresses
   *
   * Creates a new address for the profile. If the profile has no existing
   * main address, the new address is automatically set as main.
   */
  @Post(':profileId/addresses')
  @HttpCode(201)
  @RateLimit({ namespace: 'profiles:addresses:create:user', limit: 20, windowMs: 60_000 })
  @ApiOperation({ summary: 'Create a new address for a profile' })
  @ApiResponse({ status: 201, description: 'Address created.' })
  @ApiResponse({ status: 400, description: 'Validation error' })
  @ApiResponse({ status: 401, description: 'Not authenticated' })
  @ApiResponse({ status: 404, description: 'Profile not found' })
  async createAddress(
    @Param('profileId', new ParseUUIDPipe()) profileId: string,
    @Body()
    body: {
      provinceId: string;
      cityId: string;
      fullAddress: string;
      postalCode: string;
      mainAddress?: boolean;
    },
    @Req() req: AuthenticatedRequest
  ) {
    const userId = req.session.userId;

    const parsed = createAddressInput.safeParse(body);
    if (!parsed.success)
      throw new HttpException(
        { statusCode: 400, error: ErrorCodes.VALIDATION_INPUT_INVALID.code },
        400
      );
    const address = await this.profilesService.createAddress(userId, profileId, parsed.data);

    this.logger.log(`Address ${address.id} created for profile ${profileId} by user ${userId}`);
    return address;
  }

  /**
   * PUT /api/profiles/:profileId/addresses/:addressId
   *
   * Updates an address's fields. Only the address data fields (province,
   * city, full address, postal code) can be updated. To change the main
   * address flag, use POST set-main.
   */
  @Put(':profileId/addresses/:addressId')
  @HttpCode(200)
  @RateLimit({ namespace: 'profiles:addresses:update:user', limit: 20, windowMs: 60_000 })
  @ApiOperation({ summary: 'Update an address' })
  @ApiResponse({ status: 200, description: 'Address updated.' })
  @ApiResponse({ status: 400, description: 'Validation error' })
  @ApiResponse({ status: 401, description: 'Not authenticated' })
  @ApiResponse({ status: 404, description: 'Address or profile not found' })
  async updateAddress(
    @Param('profileId', new ParseUUIDPipe()) profileId: string,
    @Param('addressId', new ParseUUIDPipe()) addressId: string,
    @Body()
    body: {
      provinceId?: string;
      cityId?: string;
      fullAddress?: string;
      postalCode?: string;
    },
    @Req() req: AuthenticatedRequest
  ) {
    const userId = req.session.userId;

    const parsed = updateAddressInput.safeParse(body);
    if (!parsed.success)
      throw new HttpException(
        { statusCode: 400, error: ErrorCodes.VALIDATION_INPUT_INVALID.code },
        400
      );
    const address = await this.profilesService.updateAddress(
      userId,
      profileId,
      addressId,
      parsed.data
    );

    this.logger.log(`Address ${addressId} updated for profile ${profileId} by user ${userId}`);
    return address;
  }

  /**
   * DELETE /api/profiles/:profileId/addresses/:addressId
   *
   * Deletes an address. The main address cannot be deleted without setting
   * a new main first. Historical order snapshots remain unchanged.
   */
  @Delete(':profileId/addresses/:addressId')
  @HttpCode(200)
  @RateLimit({ namespace: 'profiles:addresses:delete:user', limit: 20, windowMs: 60_000 })
  @ApiOperation({ summary: 'Delete an address' })
  @ApiResponse({ status: 200, description: 'Address deleted.' })
  @ApiResponse({
    status: 400,
    description: 'Cannot delete main address or address linked to order',
  })
  @ApiResponse({ status: 401, description: 'Not authenticated' })
  @ApiResponse({ status: 404, description: 'Address or profile not found' })
  async deleteAddress(
    @Param('profileId', new ParseUUIDPipe()) profileId: string,
    @Param('addressId', new ParseUUIDPipe()) addressId: string,
    @Req() req: AuthenticatedRequest
  ) {
    const userId = req.session.userId;
    await this.profilesService.deleteAddress(userId, profileId, addressId);
    this.logger.log(`Address ${addressId} deleted for profile ${profileId} by user ${userId}`);
    return { message: 'Address deleted successfully.' };
  }

  /**
   * POST /api/profiles/:profileId/addresses/:addressId/set-main
   *
   * Sets an address as the main address for the profile. Only one address
   * can be main at a time. The previous main address is unset. Idempotent
   * — if the address is already main, returns success.
   */
  @Post(':profileId/addresses/:addressId/set-main')
  @HttpCode(200)
  @RateLimit({ namespace: 'profiles:addresses:set-main:user', limit: 20, windowMs: 60_000 })
  @ApiOperation({ summary: 'Set an address as the main address' })
  @ApiResponse({ status: 200, description: 'Address set as main.' })
  @ApiResponse({ status: 401, description: 'Not authenticated' })
  @ApiResponse({ status: 404, description: 'Address or profile not found' })
  async setMainAddress(
    @Param('profileId', new ParseUUIDPipe()) profileId: string,
    @Param('addressId', new ParseUUIDPipe()) addressId: string,
    @Req() req: AuthenticatedRequest
  ) {
    const userId = req.session.userId;
    const address = await this.profilesService.setMainAddress(userId, profileId, addressId);
    this.logger.log(`Address ${addressId} set as main for profile ${profileId} by user ${userId}`);
    return address;
  }

  /**
   * POST /api/profiles/:profileId/transfer-ownership
   *
   * Initiates an ownership transfer for a legal profile. The caller must
   * be the current profile owner (profiles.user_id). The target user
   * must be an existing agent of the profile. Creates a pending transfer
   * record that the new owner must accept.
   *
   * Only one pending transfer per profile is allowed at a time.
   * Transfers expire after 7 days if not accepted.
   */
  @RequiresStepUp()
  @UseGuards(StepUpGuard)
  @Post(':profileId/transfer-ownership')
  @HttpCode(201)
  @RateLimit({ namespace: 'profiles:transfer-ownership:initiate', limit: 5, windowMs: 60_000 })
  @ApiOperation({ summary: 'Initiate ownership transfer for a legal profile' })
  @ApiResponse({ status: 201, description: 'Ownership transfer initiated.' })
  @ApiResponse({
    status: 400,
    description: 'Validation error — target not an agent, or not a legal profile.',
  })
  @ApiResponse({ status: 401, description: 'Not authenticated' })
  @ApiResponse({ status: 403, description: 'Only the profile owner can initiate transfer' })
  @ApiResponse({ status: 404, description: 'Profile not found' })
  @ApiResponse({ status: 409, description: 'A pending transfer already exists' })
  async initiateOwnershipTransfer(
    @Param('profileId') profileId: string,
    @Body() body: unknown,
    @Req() req: AuthenticatedRequest
  ) {
    const userId = req.session.userId;

    const parsed = z.object({ newOwnerUserId: z.string().trim().min(1).max(128) }).safeParse(body);
    if (!parsed.success || !z.uuid().safeParse(profileId).success) {
      throw new HttpException(
        {
          statusCode: 400,
          error: ErrorCodes.VALIDATION_INPUT_MISSING.code,
          message: 'newOwnerUserId is required',
        },
        400
      );
    }

    const result = await this.agentsService.initiateOwnershipTransfer(
      profileId,
      parsed.data.newOwnerUserId,
      req.session
    );

    this.logger.log(
      `Ownership transfer ${result.id} initiated for profile ${profileId} by user ${userId}`
    );

    return result;
  }
}
