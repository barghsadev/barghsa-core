import {
  Controller,
  Get,
  HttpCode,
  HttpException,
  Logger,
  Param,
  Req,
  UseGuards,
} from '@nestjs/common'
import { ApiOperation, ApiParam, ApiResponse, ApiTags } from '@nestjs/swagger'
import { CrmV2Service } from './crm-v2.service.js'
import { SessionAuthGuard } from '../session/session.guard.js'
import type { AuthenticatedRequest } from '../session/session.guard.js'
import { ErrorCodes } from '@barghsa/shared/errors'

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
}