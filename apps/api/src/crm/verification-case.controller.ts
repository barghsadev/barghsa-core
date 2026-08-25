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
  Query,
  Req,
  UseGuards,
} from '@nestjs/common'
import { ApiBody, ApiOperation, ApiParam, ApiQuery, ApiResponse, ApiTags } from '@nestjs/swagger'
import { VerificationCaseService } from './verification-case.service.js'
import { SessionAuthGuard } from '../session/session.guard.js'
import type { AuthenticatedRequest } from '../session/session.guard.js'
import { ErrorCodes } from '@barghsa/shared/errors'

// ── DTOs ──────────────────────────────────────────────────────────────

export interface CreateVerificationCaseDto {
  /** The identity field being corrected (e.g. 'first_name', 'last_name', 'national_id', 'legal_name'). */
  fieldName: string
  /** The current value of the field (may be null if not set). */
  currentValue: string | null
  /** The requested new value. */
  requestedValue: string
  /** Optional array of S3 keys / URLs for uploaded evidence documents. */
  evidenceUrls?: string[]
  /** Reason/description for the correction request. */
  reason: string
}

export interface ReviewVerificationCaseDto {
  /** Decision: 'Under Review' | 'Approved' | 'Rejected'. */
  decision: 'Under Review' | 'Approved' | 'Rejected'
  /** Reviewer notes (required for Rejected). */
  reviewerNotes?: string
}

@ApiTags('CRM Verification Cases')
@Controller('api/crm')
@UseGuards(SessionAuthGuard)
export class VerificationCaseController {
  private readonly logger = new Logger(VerificationCaseController.name)

  constructor(
    private readonly verificationCaseService: VerificationCaseService,
  ) {}

  /**
   * POST /api/crm/profiles/:profileId/verification-cases
   *
   * Creates a verification case to correct a verified identity field.
   * Identity fields (firstName, lastName, nationalId, legalName,
   * nationalIdentifier) cannot be directly edited — staff must create
   * a case that a reviewer approves.
   *
   * Permission: admin or staff with crm:edit-identity role.
   * Audit: verification_case_created with case details.
   */
  @Post('profiles/:profileId/verification-cases')
  @HttpCode(201)
  @ApiOperation({ summary: 'Create a verification case for identity field correction' })
  @ApiParam({
    name: 'profileId',
    required: true,
    description: 'UUID of the profile requiring identity correction.',
    type: String,
  })
  @ApiBody({
    schema: {
      type: 'object',
      required: ['fieldName', 'requestedValue', 'reason'],
      properties: {
        fieldName: { type: 'string', description: 'Identity field to correct (e.g. first_name, last_name, national_id, legal_name)' },
        currentValue: { type: 'string', nullable: true, description: 'Current value of the field' },
        requestedValue: { type: 'string', description: 'New requested value' },
        evidenceUrls: { type: 'array', items: { type: 'string' }, description: 'Evidence document URLs' },
        reason: { type: 'string', description: 'Reason for the correction' },
      },
    },
  })
  @ApiResponse({ status: 201, description: 'Verification case created' })
  @ApiResponse({ status: 400, description: 'Validation error' })
  @ApiResponse({ status: 401, description: 'Not authenticated' })
  @ApiResponse({ status: 403, description: 'Staff or admin role required' })
  @ApiResponse({ status: 404, description: 'Profile not found' })
  async createCase(
    @Param('profileId') profileId: string,
    @Body() dto: CreateVerificationCaseDto,
    @Req() req: AuthenticatedRequest,
  ) {
    const isAdmin = req.session.isAdmin ?? false
    if (!isAdmin) {
      throw new HttpException(
        { statusCode: 403, error: ErrorCodes.AUTHZ_FORBIDDEN.code, message: 'Staff or admin role required' },
        403,
      )
    }

    const result = await this.verificationCaseService.createCase(
      profileId,
      dto,
      req.session.userId,
      req.ip ?? 'unknown',
    )

    if (!result) {
      throw new HttpException(
        { statusCode: 404, error: ErrorCodes.NOT_FOUND_RESOURCE.code, message: 'Profile not found' },
        404,
      )
    }

    if ('error' in result) {
      throw new HttpException(
        { statusCode: 400, error: ErrorCodes.VALIDATION_INPUT_INVALID.code, message: result.error },
        400,
      )
    }

    this.logger.debug(`Verification case created: id=${result.id}, profileId=${profileId}, actor=${req.session.userId}`)
    return result
  }

  /**
   * GET /api/crm/verification-cases
   *
   * Lists verification cases. Defaults to all Open cases for the review queue.
   * Supports filtering by status, profile, creator.
   *
   * Permission: admin or staff with appropriate CRM role.
   */
  @Get('verification-cases')
  @HttpCode(200)
  @ApiOperation({ summary: 'List verification cases (review queue)' })
  @ApiQuery({ name: 'status', required: false, description: 'Filter by case status', type: String })
  @ApiQuery({ name: 'profileId', required: false, description: 'Filter by profile', type: String })
  @ApiQuery({ name: 'createdBy', required: false, description: 'Filter by creator', type: String })
  @ApiQuery({ name: 'limit', required: false, description: 'Max results (default 20)', type: Number })
  @ApiQuery({ name: 'offset', required: false, description: 'Pagination offset (default 0)', type: Number })
  @ApiResponse({ status: 200, description: 'List of verification cases' })
  @ApiResponse({ status: 401, description: 'Not authenticated' })
  @ApiResponse({ status: 403, description: 'Staff or admin role required' })
  async listCases(
    @Req() req: AuthenticatedRequest,
    @Query('status') status?: string,
    @Query('profileId') profileId?: string,
    @Query('createdBy') createdBy?: string,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ) {
    const isAdmin = req.session.isAdmin ?? false
    if (!isAdmin) {
      throw new HttpException(
        { statusCode: 403, error: ErrorCodes.AUTHZ_FORBIDDEN.code, message: 'Staff or admin role required' },
        403,
      )
    }

    const result = await this.verificationCaseService.listCases({
      status: status && status.length > 0 ? status : undefined,
      profileId: profileId && profileId.length > 0 ? profileId : undefined,
      createdBy: createdBy && createdBy.length > 0 ? createdBy : undefined,
      limit: Math.min(Math.max(parseInt(limit ?? '20', 10) || 20, 1), 100),
      offset: Math.max(parseInt(offset ?? '0', 10) || 0, 0),
    })

    return result
  }

  /**
   * GET /api/crm/profiles/:profileId/verification-cases
   *
   * Lists verification cases for a specific profile.
   *
   * Permission: admin or staff with appropriate CRM role.
   */
  @Get('profiles/:profileId/verification-cases')
  @HttpCode(200)
  @ApiOperation({ summary: 'List verification cases for a profile' })
  @ApiParam({ name: 'profileId', required: true, description: 'UUID of the profile', type: String })
  @ApiQuery({ name: 'status', required: false, description: 'Filter by case status', type: String })
  @ApiQuery({ name: 'limit', required: false, description: 'Max results (default 20)', type: Number })
  @ApiQuery({ name: 'offset', required: false, description: 'Pagination offset (default 0)', type: Number })
  @ApiResponse({ status: 200, description: 'List of verification cases for the profile' })
  @ApiResponse({ status: 401, description: 'Not authenticated' })
  @ApiResponse({ status: 403, description: 'Staff or admin role required' })
  async listProfileCases(
    @Param('profileId') profileId: string,
    @Req() req: AuthenticatedRequest,
    @Query('status') status?: string,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ) {
    const isAdmin = req.session.isAdmin ?? false
    if (!isAdmin) {
      throw new HttpException(
        { statusCode: 403, error: ErrorCodes.AUTHZ_FORBIDDEN.code, message: 'Staff or admin role required' },
        403,
      )
    }

    const result = await this.verificationCaseService.listCases({
      profileId,
      status: status && status.length > 0 ? status : undefined,
      limit: Math.min(Math.max(parseInt(limit ?? '20', 10) || 20, 1), 100),
      offset: Math.max(parseInt(offset ?? '0', 10) || 0, 0),
    })

    return result
  }

  /**
   * GET /api/crm/verification-cases/:caseId
   *
   * Returns full detail of a single verification case, including evidence.
   *
   * Permission: admin or staff with appropriate CRM role.
   */
  @Get('verification-cases/:caseId')
  @HttpCode(200)
  @ApiOperation({ summary: 'Get verification case detail' })
  @ApiParam({ name: 'caseId', required: true, description: 'UUID of the verification case', type: String })
  @ApiResponse({ status: 200, description: 'Verification case detail' })
  @ApiResponse({ status: 401, description: 'Not authenticated' })
  @ApiResponse({ status: 403, description: 'Staff or admin role required' })
  @ApiResponse({ status: 404, description: 'Case not found' })
  async getCase(
    @Param('caseId') caseId: string,
    @Req() req: AuthenticatedRequest,
  ) {
    const isAdmin = req.session.isAdmin ?? false
    if (!isAdmin) {
      throw new HttpException(
        { statusCode: 403, error: ErrorCodes.AUTHZ_FORBIDDEN.code, message: 'Staff or admin role required' },
        403,
      )
    }

    const result = await this.verificationCaseService.getCase(caseId)

    if (!result) {
      throw new HttpException(
        { statusCode: 404, error: ErrorCodes.NOT_FOUND_RESOURCE.code, message: 'Verification case not found' },
        404,
      )
    }

    if ('error' in result) {
      throw new HttpException(
        { statusCode: 400, error: ErrorCodes.VALIDATION_INPUT_INVALID.code, message: result.error },
        400,
      )
    }

    return result
  }

  /**
   * PUT /api/crm/verification-cases/:caseId/status
   *
   * Reviews a verification case: moves to Under Review, Approves, or Rejects.
   * Approved cases automatically update the profile identity field with
   * before/after audit recording.
   *
   * Permission: admin or staff with crm:verify role (reviewer).
   * Audit: verification_case_reviewed with decision, notes, before/after values.
   */
  @Put('verification-cases/:caseId/status')
  @HttpCode(200)
  @ApiOperation({ summary: 'Review a verification case (approve/reject/under-review)' })
  @ApiParam({ name: 'caseId', required: true, description: 'UUID of the verification case', type: String })
  @ApiBody({
    schema: {
      type: 'object',
      required: ['decision'],
      properties: {
        decision: {
          type: 'string',
          enum: ['Under Review', 'Approved', 'Rejected'],
          description: 'Review decision',
        },
        reviewerNotes: {
          type: 'string',
          description: 'Notes from the reviewer (required for Rejected)',
        },
      },
    },
  })
  @ApiResponse({ status: 200, description: 'Case status updated' })
  @ApiResponse({ status: 400, description: 'Invalid state transition or missing notes' })
  @ApiResponse({ status: 401, description: 'Not authenticated' })
  @ApiResponse({ status: 403, description: 'Staff or admin role required' })
  @ApiResponse({ status: 404, description: 'Case not found' })
  @ApiResponse({ status: 409, description: 'Invalid state transition (terminal case)' })
  async reviewCase(
    @Param('caseId') caseId: string,
    @Body() dto: ReviewVerificationCaseDto,
    @Req() req: AuthenticatedRequest,
  ) {
    const isAdmin = req.session.isAdmin ?? false
    if (!isAdmin) {
      throw new HttpException(
        { statusCode: 403, error: ErrorCodes.AUTHZ_FORBIDDEN.code, message: 'Staff or admin role required' },
        403,
      )
    }

    const result = await this.verificationCaseService.reviewCase(
      caseId,
      dto,
      req.session.userId,
      req.ip ?? 'unknown',
    )

    if (!result) {
      throw new HttpException(
        { statusCode: 404, error: ErrorCodes.NOT_FOUND_RESOURCE.code, message: 'Verification case not found' },
        404,
      )
    }

    if ('error' in result) {
      // Use 409 for invalid state transitions, 400 for validation
      const httpStatus = result.error.toLowerCase().includes('transition') ? 409 : 400
      throw new HttpException(
        {
          statusCode: httpStatus,
          error: httpStatus === 409 ? ErrorCodes.CONFLICT_STATE.code : ErrorCodes.VALIDATION_INPUT_INVALID.code,
          message: result.error,
        },
        httpStatus,
      )
    }

    this.logger.debug(
      `Verification case ${caseId} reviewed: → ${dto.decision}, reviewer=${req.session.userId}`,
    )

    return result
  }
}