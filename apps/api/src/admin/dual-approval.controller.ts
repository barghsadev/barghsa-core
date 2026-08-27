import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpException,
  Logger,
  Param,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common'
import { ApiBody, ApiOperation, ApiParam, ApiQuery, ApiResponse, ApiTags } from '@nestjs/swagger'
import { z } from 'zod'
import { SessionAuthGuard } from '../session/session.guard.js'
import type { AuthenticatedRequest } from '../session/session.guard.js'
import { ErrorCodes } from '@barghsa/shared/errors'
import {
  DualApprovalService,
  DUAL_APPROVAL_ACTION_TYPES,
  type ApprovalRequestDto,
} from './dual-approval.service.js'
import { APPROVAL_REVIEW_REASON_MAX_LENGTH } from '@barghsa/shared/finance'

/** Zod schema for the reject-request body (reason is mandatory). */
export const RejectApprovalRequestSchema = z.object({
  reason: z.string().trim().min(1).max(APPROVAL_REVIEW_REASON_MAX_LENGTH),
})

/** Human-readable labels for the supported queue statuses. */
const QUEUE_STATUSES = ['pending', 'approved', 'rejected'] as const

/**
 * Dual-approval workflow controller (S-09.07, T-09.07.02).
 *
 * Admin surface for the approval-request lifecycle:
 *
 * - `POST /api/admin/approval-requests` — initiate a request (only for
 *   actions exceeding the configured threshold, T-09.07.01);
 * - `GET /api/admin/approval-requests` — queue view (default: pending);
 * - `POST /api/admin/approval-requests/:id/approve` — second-user approval;
 * - `POST /api/admin/approval-requests/:id/reject` — second-user rejection
 *   with a mandatory reason.
 *
 * The whole surface is gated by the S-09.07 capability
 * `admin:financial:edit`. Today the session model exposes only `isAdmin`
 * (platform admin); granular staff-role permissions arrive with the role
 * system. Until then the capability maps to a platform admin session,
 * mirroring the threshold config (T-09.07.01) and the S-09.06
 * notification-delivery controllers.
 */
@ApiTags('Admin')
@Controller('api/admin/approval-requests')
@UseGuards(SessionAuthGuard)
export class DualApprovalController {
  private readonly logger = new Logger(DualApprovalController.name)

  constructor(private readonly dualApprovalService: DualApprovalService) {}

  /**
   * Permission gate for the S-09.07 dual-approval surface.
   *
   * Capability `admin:financial:edit` maps to a platform admin session
   * today; centralized here as a single enforcement point.
   */
  private assertFinancialEditPermission(req: AuthenticatedRequest): void {
    if (!(req.session.isAdmin ?? false)) {
      this.logger.warn(
        `Non-admin user ${req.session.userId} attempted to access the dual-approval surface`,
      )
      throw new HttpException(
        {
          statusCode: 403,
          error: ErrorCodes.AUTHZ_FORBIDDEN.code,
          message: 'Admin role required for dual-approval management',
        },
        403,
      )
    }
  }

  /**
   * POST /api/admin/approval-requests
   *
   * Initiate a dual-approval request for a financial action that exceeds
   * the configured threshold. If dual approval is disabled or the amount
   * does not exceed the threshold, the request is rejected (400) — the
   * workflow can never be triggered for below-threshold actions.
   */
  @Post()
  @HttpCode(201)
  @ApiOperation({ summary: 'Initiate a dual-approval request (S-09.07)' })
  @ApiBody({
    schema: {
      type: 'object',
      required: ['action_type', 'amount_irr', 'reason'],
      properties: {
        action_type: {
          type: 'string',
          enum: [...DUAL_APPROVAL_ACTION_TYPES],
          description: 'Financial action subject to dual approval',
        },
        amount_irr: {
          type: 'integer',
          description: 'IRR amount of the action (must exceed the configured threshold)',
        },
        reason: { type: 'string', description: 'Reason for the financial action' },
        details: { type: 'object', description: 'Optional transaction details' },
      },
    },
  })
  @ApiResponse({ status: 201, description: 'Approval request created', type: Object })
  @ApiResponse({ status: 400, description: 'Invalid payload or amount below threshold' })
  @ApiResponse({ status: 401, description: 'Not authenticated' })
  @ApiResponse({ status: 403, description: 'Admin role required' })
  async createApprovalRequest(
    @Body() rawBody: unknown,
    @Req() req: AuthenticatedRequest,
  ): Promise<ApprovalRequestDto> {
    this.assertFinancialEditPermission(req)
    const ip = req.ip ?? req.socket?.remoteAddress ?? 'unknown'
    return this.dualApprovalService.createApprovalRequest(
      rawBody,
      req.session.userId,
      ip,
    )
  }

  /**
   * GET /api/admin/approval-requests?status=pending&limit=50&offset=0
   *
   * Queue view for approval requests, most recent first. Defaults to the
   * pending queue; pass an explicit status to inspect the history.
   */
  @Get()
  @ApiOperation({ summary: 'List approval requests (queue view)' })
  @ApiQuery({ name: 'status', required: false, enum: QUEUE_STATUSES })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  @ApiQuery({ name: 'offset', required: false, type: Number })
  @ApiResponse({ status: 200, description: 'List of approval requests', type: [Object] })
  @ApiResponse({ status: 401, description: 'Not authenticated' })
  @ApiResponse({ status: 403, description: 'Admin role required' })
  async listApprovalRequests(
    @Query('status') status: string | undefined,
    @Query('limit') limit: string | undefined,
    @Query('offset') offset: string | undefined,
    @Req() req: AuthenticatedRequest,
  ): Promise<ApprovalRequestDto[]> {
    this.assertFinancialEditPermission(req)
    const options: Parameters<DualApprovalService['listApprovalRequests']>[0] = {}
    if (status !== undefined) {
      options.status = status as NonNullable<typeof options.status>
    }
    if (limit !== undefined) options.limit = Number(limit)
    if (offset !== undefined) options.offset = Number(offset)
    return this.dualApprovalService.listApprovalRequests(options)
  }

  /**
   * POST /api/admin/approval-requests/:id/approve
   *
   * Approve a pending request. The reviewer must be a different user from
   * the initiator. Repeated resolution attempts are rejected (409).
   */
  @Post(':id/approve')
  @HttpCode(200)
  @ApiOperation({ summary: 'Approve a pending dual-approval request' })
  @ApiParam({ name: 'id', description: 'Approval request ID' })
  @ApiResponse({ status: 200, description: 'Request approved', type: Object })
  @ApiResponse({ status: 401, description: 'Not authenticated' })
  @ApiResponse({ status: 403, description: 'Admin role required or self-approval attempt' })
  @ApiResponse({ status: 404, description: 'Request not found' })
  @ApiResponse({ status: 409, description: 'Request already resolved' })
  async approveApprovalRequest(
    @Param('id') id: string,
    @Req() req: AuthenticatedRequest,
  ): Promise<ApprovalRequestDto> {
    this.assertFinancialEditPermission(req)
    const ip = req.ip ?? req.socket?.remoteAddress ?? 'unknown'
    return this.dualApprovalService.approveApprovalRequest(id, req.session.userId, ip)
  }

  /**
   * POST /api/admin/approval-requests/:id/reject
   *
   * Reject a pending request with a mandatory reason. The reviewer must be a
   * different user from the initiator.
   */
  @Post(':id/reject')
  @HttpCode(200)
  @ApiOperation({ summary: 'Reject a pending dual-approval request (reason required)' })
  @ApiParam({ name: 'id', description: 'Approval request ID' })
  @ApiBody({
    schema: {
      type: 'object',
      required: ['reason'],
      properties: {
        reason: {
          type: 'string',
          description: 'Reason for the rejection (mandatory)',
        },
      },
    },
  })
  @ApiResponse({ status: 200, description: 'Request rejected', type: Object })
  @ApiResponse({ status: 400, description: 'Missing reason or invalid payload' })
  @ApiResponse({ status: 401, description: 'Not authenticated' })
  @ApiResponse({ status: 403, description: 'Admin role required or self-approval attempt' })
  @ApiResponse({ status: 404, description: 'Request not found' })
  @ApiResponse({ status: 409, description: 'Request already resolved' })
  async rejectApprovalRequest(
    @Param('id') id: string,
    @Body() rawBody: unknown,
    @Req() req: AuthenticatedRequest,
  ): Promise<ApprovalRequestDto> {
    this.assertFinancialEditPermission(req)

    const parsed = RejectApprovalRequestSchema.safeParse(rawBody)
    if (!parsed.success) {
      throw new HttpException(
        {
          statusCode: 400,
          error: ErrorCodes.VALIDATION_INPUT_INVALID.code,
          message: 'reason is required when rejecting an approval request',
        },
        400,
      )
    }

    const ip = req.ip ?? req.socket?.remoteAddress ?? 'unknown'
    return this.dualApprovalService.rejectApprovalRequest(
      id,
      req.session.userId,
      ip,
      parsed.data.reason,
    )
  }
}