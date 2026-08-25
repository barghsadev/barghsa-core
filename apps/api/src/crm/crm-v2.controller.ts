import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpException,
  Logger,
  Param,
  Post,
  Put,
  Req,
  UseGuards,
} from '@nestjs/common'
import { ApiBody, ApiOperation, ApiParam, ApiProperty, ApiResponse, ApiTags } from '@nestjs/swagger'
import { CrmV2Service } from './crm-v2.service.js'
import { SessionAuthGuard } from '../session/session.guard.js'
import type { AuthenticatedRequest } from '../session/session.guard.js'
import { ErrorCodes } from '@barghsa/shared/errors'

/**
 * DTO for updating a CRM profile's editable fields.
 * Identity fields (firstName, lastName, nationalId) are blocked for
 * direct editing — they require a verification case (T-05.02.05).
 * For LEGAL profiles, legal-entity fields are also blocked for direct edit.
 */
export interface UpdateProfileDto {
  title?: string | null
  /** Individual profile fields (direct edit on non-identity fields only) */
  email?: string | null
  mobile?: string | null
}

/**
 * DTO for profile verification actions.
 */
export interface VerifyProfileDto {
  /** The verification action to perform. */
  action: string
  /** Reason for the action (required for unverify/reverify). */
  reason?: string
}

@ApiTags('CRM V2')
@Controller('api/crm')
@UseGuards(SessionAuthGuard)
export class CrmV2Controller {
  private readonly logger = new Logger(CrmV2Controller.name)

  constructor(private readonly crmV2Service: CrmV2Service) {}

  /**
   * GET /api/crm/profiles/:profileId
   *
   * Returns a comprehensive profile detail view for CRM staff, including
   * profile fields, user info, verification state, session metadata
   * (count, last active), sibling profiles, and associated addresses.
   *
   * Permission: admin (crm:read) role required.
   */
  @Get('profiles/:profileId')
  @HttpCode(200)
  @ApiOperation({ summary: 'Get full profile detail for CRM staff' })
  @ApiParam({
    name: 'profileId',
    required: true,
    description: 'UUID of the profile to retrieve.',
    type: String,
  })
  @ApiResponse({
    status: 200,
    description: 'Comprehensive profile detail.',
    schema: {
      type: 'object',
      properties: {
        profile: { type: 'object' },
        user: { type: 'object' },
        legalInfo: { type: 'object', nullable: true },
        addresses: { type: 'array', items: { type: 'object' } },
        sessions: {
          type: 'object',
          properties: {
            count: { type: 'integer' },
            lastActive: { type: 'string', nullable: true },
            entries: { type: 'array', items: { type: 'object' } },
          },
        },
        siblingProfiles: { type: 'array', items: { type: 'object' } },
      },
    },
  })
  @ApiResponse({ status: 401, description: 'Not authenticated' })
  @ApiResponse({ status: 403, description: 'Staff or admin role required' })
  @ApiResponse({ status: 404, description: 'Profile not found' })
  async getProfileDetail(
    @Param('profileId') profileId: string,
    @Req() req: AuthenticatedRequest,
  ) {
    const isAdmin = req.session.isAdmin ?? false

    if (!isAdmin) {
      this.logger.warn(
        `Non-admin user ${req.session.userId} attempted to access CRM profile detail`,
      )
      throw new HttpException(
        {
          statusCode: 403,
          error: ErrorCodes.AUTHZ_FORBIDDEN.code,
          message: 'Staff or admin role required',
        },
        403,
      )
    }

    const result = await this.crmV2Service.getProfileDetail(profileId)

    if (!result) {
      throw new HttpException(
        {
          statusCode: 404,
          error: ErrorCodes.NOT_FOUND_RESOURCE.code,
          message: 'Profile not found',
        },
        404,
      )
    }

    this.logger.debug(
      `CRM profile detail: profileId=${profileId}, userId=${result.user.userId}, ` +
      `status=${result.profile.status}, sessions=${result.sessions.count}`,
    )

    return result
  }

  /**
   * PUT /api/crm/profiles/:profileId
   *
   * Updates editable fields on a CRM profile. Identity fields (firstName,
   * lastName, nationalId) and legal-entity fields are blocked for direct
   * editing — they require a verification case (T-05.02.05).
   *
   * Note: Full RBAC permission enforcement (crm:edit role) is pending
   * the role assignment system (T-09.05.01). Currently uses admin check
   * isAdmin as a secure default — all system admins have crm:edit access.
   *
   * Audit: profile_updated with before/after diff.
   * Permission: admin or staff with crm:edit role required.
   */
  @Put('profiles/:profileId')
  @HttpCode(200)
  @ApiOperation({ summary: 'Update editable profile fields (staff)' })
  @ApiParam({
    name: 'profileId',
    required: true,
    description: 'UUID of the profile to update.',
    type: String,
  })
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        title: { type: 'string', nullable: true, description: 'Profile title' },
        email: { type: 'string', nullable: true, description: 'User email (stored on users table)' },
        mobile: { type: 'string', nullable: true, description: 'User mobile (stored on users table)' },
      },
    },
  })
  @ApiResponse({ status: 200, description: 'Profile updated successfully' })
  @ApiResponse({ status: 400, description: 'Validation error — identity fields blocked' })
  @ApiResponse({ status: 401, description: 'Not authenticated' })
  @ApiResponse({ status: 403, description: 'Staff or admin role required' })
  @ApiResponse({ status: 404, description: 'Profile not found' })
  async updateProfile(
    @Param('profileId') profileId: string,
    @Body() dto: UpdateProfileDto,
    @Req() req: AuthenticatedRequest,
  ) {
    const isAdmin = req.session.isAdmin ?? false

    if (!isAdmin) {
      this.logger.warn(
        `Non-admin user ${req.session.userId} attempted to update CRM profile ${profileId}`,
      )
      throw new HttpException(
        {
          statusCode: 403,
          error: ErrorCodes.AUTHZ_FORBIDDEN.code,
          message: 'Staff or admin role required',
        },
        403,
      )
    }

    const result = await this.crmV2Service.updateProfile(
      profileId,
      dto,
      req.session.userId,
      req.ip ?? 'unknown',
    )

    if (!result) {
      throw new HttpException(
        {
          statusCode: 404,
          error: ErrorCodes.NOT_FOUND_RESOURCE.code,
          message: 'Profile not found',
        },
        404,
      )
    }

    if ('error' in result) {
      throw new HttpException(
        {
          statusCode: 400,
          error: ErrorCodes.VALIDATION_INPUT_INVALID.code,
          message: result.error,
        },
        400,
      )
    }

    return result
  }

  /**
   * POST /api/crm/profiles/:profileId/verify
   *
   * Changes the verification state of a profile. Actions:
   * - `verify` — marks profile as VERIFIED (from DRAFT or ACTIVE)
   * - `unverify` — reverts to ACTIVE (from VERIFIED)
   * - `reverify` — resets to DRAFT (from VERIFIED), flags for re-verification
   *
   * Reason is required for unverify/reverify.
   * Permission: admin or staff with crm:verify role required.
   * Audit: verification_change with before/after state, actor, reason.
   */
  @Post('profiles/:profileId/verify')
  @HttpCode(200)
  @ApiOperation({ summary: 'Change profile verification state (staff)' })
  @ApiParam({
    name: 'profileId',
    required: true,
    description: 'UUID of the profile to verify/unverify/reverify.',
    type: String,
  })
  @ApiBody({
    schema: {
      type: 'object',
      required: ['action'],
      properties: {
        action: { type: 'string', enum: ['verify', 'unverify', 'reverify'], description: 'Verification action' },
        reason: { type: 'string', description: 'Reason for the action (required for unverify/reverify)' },
      },
    },
  })
  @ApiResponse({ status: 200, description: 'Verification state changed successfully' })
  @ApiResponse({ status: 400, description: 'Validation error — invalid action or missing reason' })
  @ApiResponse({ status: 401, description: 'Not authenticated' })
  @ApiResponse({ status: 403, description: 'Staff or admin role required' })
  @ApiResponse({ status: 404, description: 'Profile not found' })
  async verifyProfile(
    @Param('profileId') profileId: string,
    @Body() dto: VerifyProfileDto,
    @Req() req: AuthenticatedRequest,
  ) {
    const isAdmin = req.session.isAdmin ?? false

    if (!isAdmin) {
      this.logger.warn(
        `Non-admin user ${req.session.userId} attempted to verify profile ${profileId}`,
      )
      throw new HttpException(
        {
          statusCode: 403,
          error: ErrorCodes.AUTHZ_FORBIDDEN.code,
          message: 'Staff or admin role required',
        },
        403,
      )
    }

    const result = await this.crmV2Service.verifyProfile(
      profileId,
      dto,
      req.session.userId,
      req.ip ?? 'unknown',
    )

    if (!result) {
      throw new HttpException(
        {
          statusCode: 404,
          error: ErrorCodes.NOT_FOUND_RESOURCE.code,
          message: 'Profile not found',
        },
        404,
      )
    }

    if ('error' in result) {
      throw new HttpException(
        {
          statusCode: 400,
          error: ErrorCodes.VALIDATION_INPUT_INVALID.code,
          message: result.error,
        },
        400,
      )
    }

    this.logger.debug(
      `Verification changed: profileId=${profileId}, ${result.previousStatus} → ${result.newStatus}, ` +
      `action=${dto.action}, actor=${req.session.userId}`,
    )

    return result
  }
}