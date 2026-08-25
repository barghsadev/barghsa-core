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
import { CrmService, type CrmListUsersFilters } from './crm.service.js'
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
  @ApiQuery({
    name: 'type',
    required: false,
    description: 'Filter by profile type: INDIVIDUAL or LEGAL.',
    enum: ['INDIVIDUAL', 'LEGAL'],
  })
  @ApiQuery({
    name: 'verification',
    required: false,
    description: 'Filter by verification status: VERIFIED, UNVERIFIED, PENDING, or DISABLED.',
    enum: ['VERIFIED', 'UNVERIFIED', 'PENDING', 'DISABLED'],
  })
  @ApiQuery({
    name: 'search',
    required: false,
    description: 'Free-text search across username, individual name, and legal name.',
    type: String,
  })
  @ApiQuery({
    name: 'dateFrom',
    required: false,
    description: 'Earliest registration date (inclusive). ISO 8601 format.',
    type: String,
  })
  @ApiQuery({
    name: 'dateTo',
    required: false,
    description: 'Latest registration date (inclusive). ISO 8601 format.',
    type: String,
  })
  @ApiQuery({
    name: 'sort',
    required: false,
    description: 'Sort column. Default: createdAt.',
    enum: ['createdAt'],
  })
  @ApiQuery({
    name: 'order',
    required: false,
    description: 'Sort order. Default: desc.',
    enum: ['asc', 'desc'],
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
    @Query('type') type: string | undefined,
    @Query('verification') verification: string | undefined,
    @Query('search') search: string | undefined,
    @Query('dateFrom') dateFrom: string | undefined,
    @Query('dateTo') dateTo: string | undefined,
    @Query('sort') sort: string | undefined,
    @Query('order') order: string | undefined,
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

    // Build filters object from query params
    const filters: CrmListUsersFilters = {}
    if (type === 'INDIVIDUAL' || type === 'LEGAL') {
      filters.type = type
    }
    if (verification === 'VERIFIED' || verification === 'UNVERIFIED' || verification === 'PENDING' || verification === 'DISABLED') {
      filters.verification = verification
    }
    if (search) {
      filters.search = search
    }
    if (dateFrom) {
      filters.dateFrom = dateFrom
    }
    if (dateTo) {
      filters.dateTo = dateTo
    }
    if (sort === 'createdAt') {
      filters.sort = sort
    }
    if (order === 'asc' || order === 'desc') {
      filters.order = order
    }

    const parsedLimit = limit ? parseInt(limit, 10) : 20
    const result = await this.crmService.listUsers(
      cursor ?? null,
      isNaN(parsedLimit) ? 20 : parsedLimit,
      filters,
    )

    this.logger.debug(
      `CRM users list: returned ${result.users.length} user(s), hasMore=${result.hasMore}`,
    )

    return result
  }
}