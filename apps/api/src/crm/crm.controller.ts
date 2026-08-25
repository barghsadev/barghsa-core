import {
  Controller,
  Get,
  HttpCode,
  HttpException,
  Logger,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common'
import { ApiOperation, ApiQuery, ApiResponse, ApiTags } from '@nestjs/swagger'
import { CrmService } from './crm.service.js'
import { SessionAuthGuard } from '../session/session.guard.js'
import type { AuthenticatedRequest } from '../session/session.guard.js'
import { ErrorCodes } from '@barghsa/shared/errors'

@ApiTags('CRM')
@Controller('api/crm')
@UseGuards(SessionAuthGuard)
export class CrmController {
  private readonly logger = new Logger(CrmController.name)

  constructor(private readonly crmService: CrmService) {}

  /**
   * GET /api/crm/users
   *
   * Returns a paginated list of all registered users with profile
   * summaries. Staff (crm:read) and admin only.
   *
   * Permission is enforced inline here until a dedicated permissions
   * framework is wired. The session object carries an `isAdmin` flag;
   * a future T-09.05.01 (role management) will add granular
   * `crm:read` permission checks. For now, staff with crm:read-only
   * roles will get 403 until the role/permission system is wired.
   */
  @Get('users')
  @HttpCode(200)
  @ApiOperation({ summary: 'List registered users (CRM staff/admin)' })
  @ApiQuery({
    name: 'cursor',
    required: false,
    description: 'Opaque pagination cursor from a previous response.',
    type: String,
  })
  @ApiQuery({
    name: 'limit',
    required: false,
    description: 'Max results per page (1–100, default 20).',
    type: Number,
  })
  @ApiResponse({
    status: 200,
    description: 'Paginated list of users.',
    schema: {
      type: 'object',
      properties: {
        users: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              userId: { type: 'string' },
              username: { type: 'string' },
              email: { type: 'string', nullable: true },
              mobile: { type: 'string', nullable: true },
              registrationDate: { type: 'string' },
              lastLogin: { type: 'string', nullable: true },
              profileCount: { type: 'integer' },
              hasIndividualProfile: { type: 'boolean' },
              hasLegalProfile: { type: 'boolean' },
              hasVerifiedProfile: { type: 'boolean' },
            },
          },
        },
        cursor: { type: 'string', nullable: true },
        hasMore: { type: 'boolean' },
      },
    },
  })
  @ApiResponse({ status: 401, description: 'Not authenticated' })
  @ApiResponse({ status: 403, description: 'Staff or admin role required' })
  async listUsers(
    @Query('cursor') cursor: string | undefined,
    @Query('limit') limit: string | undefined,
    @Req() req: AuthenticatedRequest,
  ) {
    const isAdmin = req.session.isAdmin ?? false

    if (!isAdmin) {
      this.logger.warn(
        `Non-admin user ${req.session.userId} attempted to access CRM`,
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

    const parsedLimit = limit ? parseInt(limit, 10) : 20
    const result = await this.crmService.listUsers(
      cursor ?? null,
      isNaN(parsedLimit) ? 20 : parsedLimit,
    )

    this.logger.debug(
      `CRM users list: returned ${result.users.length} user(s), hasMore=${result.hasMore}`,
    )

    return result
  }
}